// H6 P2 Bundle 2 A/A2/C1/D · `/acp-vw lll <spec>` spawn entrypoint.
//
// Flow:
//   1. Parse the raw slash arg via parseLocalLlmSpec (D17 · Bundle 1
//      export reuse · same grammar as outer-LLM model routing).
//   2. Reachability precheck for remote (D20): ensure manager knows the
//      node and marks it reachable before launching the PTY. Avoids the
//      default 30 s ssh-t hang when a node is unreachable.
//   3. Inventory probe (warn-only) + model-runtime lookup (D25). The
//      lookup lets us pick the right adapter/cmd pair:
//        runtime='lmstudio' (or unknown pre-probe) → `lms chat <m>`
//        runtime='ollama'                          → `ollama run <m>`
//   4. Brand + extraArgs composition (D19 × D25 · 4-way dispatch by
//      nodeId × runtime).
//   5. Delegate to spawnEmbodiedAgentInVW which launches the matching
//      adapter and wires PTY/observer/VW window.
//
// See PLAN §3.0.1 + §3.0.2 + §3.0.4 + D14-D26.

import { parseLocalLlmSpec, type LocalLlmSpec } from '../llm/local-manager/types.js';
import type { LlmRuntime } from '../llm/local-manager/types.js';
import {
  getInventory,
  listModelsFor,
  type ManagerDeps,
} from '../llm/local-manager/manager.js';
import { findNode } from '../llm/local-manager/node-registry.js';
import {
  spawnEmbodiedAgentInVW,
  type SpawnEmbodiedAgentResult,
} from './spawn-embodied-agent-in-vw.js';
import { debug } from '../debug/log.js';

export interface SpawnLocalLlmOpts {
  /** Raw slash arg · accepts `local:<model>`, `<node>:<model>`,
   *  `local-llm:<node>:<model>`, `local-llm:<model>`, or bare
   *  `<model>` (implicit local). */
  readonly rawSpec: string;
  readonly cwd?: string;
  readonly title?: string;
  /** Injected for tests · production leaves undefined to use the
   *  process-wide manager cache. */
  readonly managerDeps?: ManagerDeps;
}

/** Parse + validate + delegate · throws with actionable messages on
 *  bad input, unknown / unreachable node, or missing spawn wiring. */
export async function spawnLocalLlmInVW(
  opts: SpawnLocalLlmOpts,
): Promise<SpawnEmbodiedAgentResult> {
  const spec = parseSlashInput(opts.rawSpec);
  if (!spec) {
    throw new Error(
      `invalid local-llm spec · expected 'local:<model>' or '<node>:<model>' or 'local-llm:<node>:<model>' · got '${opts.rawSpec}'`,
    );
  }

  // D20 · Reachability precheck for remote nodes. Local node skips
  // this (the user's own elanous host is by definition "reachable";
  // the manager probe only tells us whether LM Studio / Ollama is
  // running, which lms chat / ollama run surface fine if missing).
  if (spec.nodeId !== 'local') {
    await ensureRemoteReachable(spec.nodeId, opts.managerDeps);
  }

  // Soft inventory probe (warn-only · inventory can be stale).
  try {
    await getInventory(opts.managerDeps ?? {});
  } catch (err) {
    // Always-on file trail (4.2 elevation · 2026-04-22): user-driven
    // spawn rate ≪ keystroke rate, so the per-call object literal is
    // cheap and the forensic value (diagnose `/acp-vw lll` failures from
    // log/latest alone) is high. debug.log itself no-ops only when ALL
    // sinks are off (default file sink stays on).
    debug.log('spawn.local-llm.inventory-probe-failed', spec.nodeId, {
      modelId: spec.modelId,
      err: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }

  // D25 · Runtime lookup from inventory. When the model isn't cached
  // (pre-probe or literally not installed), we default to LM Studio
  // for Bundle 1/2 A compat — users whose model IS Ollama should
  // `/llm refresh` first (which the ensureRemoteReachable path already
  // does implicitly for remote nodes).
  const inventoryModels = listModelsFor(spec.nodeId);
  const hostedModel = inventoryModels.find((m) => m.id === spec.modelId);
  const runtime: LlmRuntime = hostedModel?.runtime ?? 'lmstudio';
  // 4.2 elevation · always-on (see header comment above on rationale).
  debug.log('spawn.local-llm.spec', spec.nodeId, {
    modelId: spec.modelId,
    runtime,
    availableInInventory: Boolean(hostedModel),
    inventoryCount: inventoryModels.length,
  });

  // D19 × D25 · Brand + extraArgs composition per (nodeId × runtime).
  const { brand, extraArgs } = composeBrandArgs(spec, runtime);

  const r = await spawnEmbodiedAgentInVW({
    brand,
    mode: 'pty-direct',
    cwd: opts.cwd,
    extraArgs,
    title: opts.title ?? defaultTitle(spec),
  });

  // 4.2 elevation · always-on. The PTY spawn outcome is the most
  // useful single trace for "did the embodied session actually start"
  // triage — keep it always reachable via log/latest.
  debug.log('spawn.local-llm.launched', spec.nodeId, {
    modelId: spec.modelId,
    runtime,
    brand,
    sessionId: r.session.id,
    paneId: r.paneId,
    windowId: r.windowId,
  });

  return r;
}

/** D20 · Ensure the remote node exists in the fleet and is reachable.
 *  If the node hasn't been probed yet (`lastProbedAt === 0`), trigger
 *  one `getInventory()` call to populate the cache, then re-check. */
async function ensureRemoteReachable(
  nodeId: string,
  managerDeps: ManagerDeps | undefined,
): Promise<void> {
  let node = findNode(nodeId);
  if (!node) {
    throw new Error(
      `unknown node '${nodeId}' · run /llm nodes to list the Tailscale fleet or add it to ssh-hosts.json`,
    );
  }
  if (node.lastProbedAt === 0) {
    // Never probed · trigger one full inventory probe so reachable is
    // populated. Any probe error is swallowed here — findNode re-check
    // below surfaces the final state.
    try {
      await getInventory(managerDeps ?? {});
    } catch (err) {
      // 4.2 elevation · always-on.
      debug.log('spawn.local-llm.remote-precheck-probe-failed', nodeId, {
        err: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
    }
    node = findNode(nodeId);
    if (!node) {
      throw new Error(`unknown node '${nodeId}' after probe · run /llm refresh`);
    }
  }
  if (node.reachable !== true) {
    throw new Error(
      `node '${nodeId}' unreachable · check /llm nodes for warnings (ssh-timeout · cli-missing · unreachable · ssh-auth · daemon-down) and run /llm refresh after fixing`,
    );
  }
  // 4.2 elevation · always-on. Confirms the precheck succeeded so a
  // subsequent failure is unambiguously downstream (PTY/SSH spawn vs
  // reachability gate).
  debug.log('spawn.local-llm.remote-precheck-ok', nodeId, {
    lastProbedAt: node.lastProbedAt,
    runtimes: node.runtimes,
  });
}

/** D19 × D25 · 4-way dispatch by nodeId × runtime. Known runtime
 *  matrix:
 *    local + lmstudio → brand 'local-llm'                · lms chat <m>
 *    local + ollama   → brand 'local-llm-ollama'         · ollama run <m>
 *    remote + lmstudio → brand 'local-llm-remote'        · ssh -t <n> lms chat <m>
 *    remote + ollama   → brand 'local-llm-ollama-remote' · ssh -t <n> ollama run <m>
 *  Runtimes other than lmstudio/ollama (mlx · llamacpp · docker) fall
 *  back to LM Studio for Bundle 2 compat — MLX/Docker embodied are
 *  Bundle 2 C2/C3. */
function composeBrandArgs(
  spec: LocalLlmSpec,
  runtime: LlmRuntime,
): {
  brand: string;
  extraArgs: readonly string[];
} {
  const isLocal = spec.nodeId === 'local';
  const isOllama = runtime === 'ollama';

  if (isLocal && isOllama) {
    return { brand: 'local-llm-ollama', extraArgs: [spec.modelId] };
  }
  if (isLocal) {
    // lmstudio (or unknown → lmstudio fallback)
    return { brand: 'local-llm', extraArgs: [spec.modelId] };
  }
  if (isOllama) {
    // remote Ollama · ssh -t <node> ollama run <model>
    return {
      brand: 'local-llm-ollama-remote',
      extraArgs: [spec.nodeId, 'ollama', 'run', spec.modelId],
    };
  }
  // remote lmstudio · ssh -t <node> lms chat <model>
  return {
    brand: 'local-llm-remote',
    extraArgs: [spec.nodeId, 'lms', 'chat', spec.modelId],
  };
}

/** Default VW window title. Runtime is surfaced in logs + session
 *  metadata but intentionally left out of the title to keep Bundle 2 A
 *  UX stable (pane chrome stays consistent when user toggles between
 *  lmstudio and ollama models). */
function defaultTitle(spec: LocalLlmSpec): string {
  if (spec.nodeId === 'local') return `local-llm:${spec.modelId}`;
  return `local-llm:${spec.nodeId}:${spec.modelId}`;
}

/** Accept the multiple shapes a user might type after `/acp-vw lll`:
 *   - `local:<model>`                    (legacy · parseLocalLlmSpec direct)
 *   - `local-llm:<model>`                (canonical implicit local)
 *   - `local-llm:<node>:<model>`         (canonical explicit)
 *   - `<node>:<model>`                   (bare · prepend `local-llm:`)
 *   - `<model>`                          (bare · assume local node)
 *
 *  Returns null when the input is empty or unparseable. */
function parseSlashInput(raw: string): LocalLlmSpec | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = parseLocalLlmSpec(trimmed);
  if (direct) return direct;
  if (trimmed.includes(':')) return parseLocalLlmSpec(`local-llm:${trimmed}`);
  return parseLocalLlmSpec(`local-llm:local:${trimmed}`);
}

/** Exposed for tests · same parsing the slash uses. */
export const _parseSlashInputForTesting = parseSlashInput;

/** Exposed for tests · D19 × D25 brand dispatch composition.
 *  Callers pass the runtime they resolved from inventory (or 'lmstudio'
 *  as the default when the model isn't cached). */
export const _composeBrandArgsForTesting = composeBrandArgs;
