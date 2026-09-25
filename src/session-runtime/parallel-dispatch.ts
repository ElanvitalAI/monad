// ── Parallel tool dispatch (Coding Pipeline P2) ──
//
// Helper for the llm.ts tool loop. Partitions a batch of tool calls
// into safe (parallel-eligible) and unsafe (must stay sequential)
// groups based on the `supportsParallel` meta in nativeToolCatalog,
// then dispatches safe ones via Promise.all (allSettled in spirit —
// dispatchOne already catches per-call errors) while keeping unsafe
// ones strictly sequential.
//
// Pattern adapted from:
//   - claude-code-fork `src/services/tools/toolOrchestration.ts:19-82`
//     (`isConcurrencySafe()` batch partitioning)
//   - codex `codex-rs/tools/src/tool_spec.rs:121-137`
//     (`ConfiguredToolSpec.supports_parallel_tool_calls`)
//
// Design choices:
//
//   1. Result ordering is preserved in the caller's `results` array.
//      Callers pass a `writeResult(index, r)` callback; we index into
//      their storage — not our own — so the tool_result blocks that
//      get pushed to the LLM conversation stay in original call order.
//
//   2. Agent is always sequential for this partitioner. The tool loop
//      has a separate, richer Agent-batch path (with onAgentBatchStart/
//      Tick/End UX events) upstream of this helper. When the caller
//      enters the Agent-batch path, they don't call this helper.
//
//   3. Post-processing hooks (onToolCall / onToolResult / verifyArmed
//      flip) run inside the dispatch callback the caller provides, so
//      we stay policy-free: the helper only decides ORDER, not POLICY.
//
//   4. MVP safety net: when `supportsParallel` is undefined or false,
//      the tool goes to the `unsafe` group. A miss-classified mutating
//      tool without the flag stays sequential — never parallelised.
//
// Non-goals:
//
//   - Concurrency capping — if the LLM asks for 12 parallel Reads, we
//     run 12. Provider response time is the natural backpressure.
//   - Reordering within the safe group — Promise.all fires them all
//     at once and we let the runtime decide actual scheduling.

import { findNativeTool } from '../native-tool-catalog.js';

export interface CallWithIndex<T> {
  call: T;
  index: number;
}

/** Look up the catalog `supportsParallel` flag by tool name / alias.
 *  Returns false (conservative) when the tool isn't in the catalog so
 *  unknown / plugin tools default to sequential until explicitly opted
 *  in via catalog metadata. */
export function isSafeForParallel(toolName: string): boolean {
  // Agent is handled by the separate agent-batch path in llm.ts even
  // when the catalog marks it supportsParallel=true. Excluding it here
  // keeps this helper composable with the existing Agent path without
  // double-dispatch.
  if (toolName === 'Agent') return false;
  const entry = findNativeTool(toolName);
  return entry?.supportsParallel === true;
}

/** Split `calls` into (safe, unsafe) keeping original `index` so the
 *  caller can write back to a positionally-stable results array. */
export function partitionByParallelSafety<T extends { name: string }>(
  calls: readonly T[],
): { safe: CallWithIndex<T>[]; unsafe: CallWithIndex<T>[] } {
  const safe: CallWithIndex<T>[] = [];
  const unsafe: CallWithIndex<T>[] = [];
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    const bucket = isSafeForParallel(call.name) ? safe : unsafe;
    bucket.push({ call, index: i });
  }
  return { safe, unsafe };
}

/** Dispatch all `calls` honouring parallel safety:
 *   - Safe calls run concurrently via Promise.all
 *   - Unsafe calls run strictly sequentially, in their original order
 *
 *   The caller provides `dispatchOne(call, index): Promise<void>` which
 *   is responsible for:
 *     - calling the tool
 *     - firing onToolCall / onToolResult / policy hooks
 *     - writing the result into the caller's results storage at `index`
 *
 *   Returns after all calls (safe + unsafe) have resolved. Ordering:
 *   safe group fires first (parallel kickoff), then unsafe group runs
 *   in original pending-calls order. This matches the Agent-batch path
 *   which also drains non-Agent calls before the parallel Agent batch.
 *
 *   When `safe.length < 2`, the helper degenerates into pure sequential
 *   dispatch in original order — no parallelism benefit for 0-1 safe
 *   calls so we keep behaviour identical to pre-P2. */
export async function dispatchWithParallelSafety<T extends { name: string }>(
  calls: readonly T[],
  dispatchOne: (call: T, index: number) => Promise<void>,
): Promise<{ safeCount: number; unsafeCount: number; parallelActivated: boolean }> {
  const { safe, unsafe } = partitionByParallelSafety(calls);
  const parallelActivated = safe.length >= 2;
  if (!parallelActivated) {
    // Fall back to pure sequential in original order. Keeps pre-P2
    // behaviour bit-exact when only one read tool is in the batch
    // (common case — no benefit to firing Promise.all for a single
    // call).
    for (let i = 0; i < calls.length; i += 1) {
      await dispatchOne(calls[i]!, i);
    }
    return { safeCount: safe.length, unsafeCount: unsafe.length, parallelActivated };
  }
  // Parallel kickoff for the safe group. Promise.all is safe here
  // because `dispatchOne` is expected to catch its own errors and
  // write an error result into the caller's storage — we never want
  // one failing Read to cancel two sibling Reads.
  await Promise.all(safe.map(({ call, index }) => dispatchOne(call, index)));
  // Unsafe group: sequential, in original order.
  for (const { call, index } of unsafe) {
    await dispatchOne(call, index);
  }
  return { safeCount: safe.length, unsafeCount: unsafe.length, parallelActivated };
}
