// ── MaterializeFromIntent runtime — IUL Phase L · Bundle 4W ──
//
// Wraps `dispatchMaterializeFromIntent` in the ToolRuntime shape so
// dashboard / skill-runner / future MCP export use the same one-liner
// `dispatchToolByName('MaterializeFromIntent', args, ctx)`.
//
// Mutating (spawns a widget by default) — callers may gate with
// requireApproval if policy demands, but current Phase L scope treats
// LLM-driven widget spawn as a natural continuation of the user's
// intent. `dryRun: true` in args short-circuits the spawn.
//
// Ownership note (2026-04-20 · PLAN-iul-closure-roadmap.md §0.5):
// This file lives under `src/tool-runtime/` (terminal-team owned dir)
// but is scoped to widget-team's IUL Phase L work. Terminal team ACKed
// single-file addition on condition no existing runtime files are
// modified. See PR description + ownership protocol.

import {
  buildMaterializeFromIntentTool,
  dispatchMaterializeFromIntent,
  type MaterializeIntentDeps,
} from '../../plugins/iul-shared/materialize-intent-tool.js';
import { _resetToolRuntimeRegistryForTest, registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

type Args = Record<string, unknown>;
type Out = { output: string };

function stringifyOutput(obj: unknown): Out {
  return { output: JSON.stringify(obj) };
}

/** Build the runtime. Exposed for test harnesses that want direct
 *  access without going through the global registry. */
export function createMaterializeFromIntentRuntime(
  deps: MaterializeIntentDeps,
): ToolRuntime<Args, Out> {
  return {
    id: 'iul_materialize_from_intent',
    spec: buildMaterializeFromIntentTool(),
    async run(req) {
      const result = await dispatchMaterializeFromIntent(req, deps);
      return stringifyOutput(result);
    },
  };
}

let registered = false;
let registeredDeps: MaterializeIntentDeps | null = null;

/** Idempotent registration — dashboard calls once at boot after
 *  widgetHost is available. Re-invocation with the same deps is a
 *  no-op; calling with different deps is rejected (caller must reset
 *  via `__resetMaterializeRuntimesForTest` first to swap). */
export function registerMaterializeRuntimes(deps: MaterializeIntentDeps): void {
  if (registered) {
    if (registeredDeps !== deps) {
      throw new Error(
        'registerMaterializeRuntimes: already registered with different deps '
        + '— call __resetMaterializeRuntimesForTest first',
      );
    }
    return;
  }
  registerToolRuntime(createMaterializeFromIntentRuntime(deps));
  registered = true;
  registeredDeps = deps;
}

/** Test-only — reset so integration tests re-run registration with
 *  fresh deps. **Wipes the entire ToolRuntime registry** (not just the
 *  MaterializeFromIntent entry); test harnesses must re-register any
 *  other runtimes they rely on. Safe because test files are isolated
 *  per-file under bun's runner. */
export function __resetMaterializeRuntimesForTest(): void {
  registered = false;
  registeredDeps = null;
  _resetToolRuntimeRegistryForTest();
}
