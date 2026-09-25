// ── Bash ToolRuntime ──
//
// Wraps dispatchBash (src/skill-tools.ts) in the ToolRuntime shape so
// the dashboard chat loop can dispatch Bash via the same registry the
// PtyShell* + TerminalModalInject tools use, instead of threading
// yet another inline branch through dashboard.ts.
//
// DI model:
//
//   Bash is cwd + shell + timeout-bounded at the call site. The
//   runtime carries a module-level deps slot for shell / timeout /
//   sandbox knobs; cwd is pulled LAZILY from the session-working-dir
//   singleton at each run() so a Ctrl+W in the browser pane or a /wd
//   slash retargets subsequent Bash calls immediately.
//   Skill-runner continues to use its direct-dispatch map so each
//   skill's BashToolOpts (skill dir cwd, manifest-supplied shell /
//   timeouts) keep working unchanged — this migration is about
//   adding a second entry point, not moving the skill path.
//
// Signal forwarding: ctx.signal flows into opts.signal so a dashboard
// Esc abort kills the in-flight child process (parity with the skill
// streaming path).

import { buildBashTool, dispatchBash, type BashResult, type BashToolOpts } from '../skills/tools/index.js';
import { getSessionCwd } from '../session/working-dir.js';
import type { ToolRuntime, ToolRuntimeContext } from './types.js';

/** Subset of BashToolOpts that the runtime pins via module state.
 *  cwd is OPTIONAL in deps — when unset, the runtime pulls the
 *  current session working directory at every dispatch (WD5). Pass
 *  an explicit cwd only if you need to pin a specific directory
 *  regardless of SWD flips (tests, scoped subprocess managers). */
export type BashRuntimeDeps = Partial<Omit<BashToolOpts, 'signal'>>;

let deps: BashRuntimeDeps | null = null;

/** Wire the deps the runtime will pass into dispatchBash on every
 *  call. Pass null to un-set (tests). */
export function setBashRuntimeDeps(d: BashRuntimeDeps | null): void {
  deps = d;
}

/** Test helper — inspect the current deps binding. */
export function _getBashRuntimeDepsForTesting(): BashRuntimeDeps | null {
  return deps;
}

export const bashRuntime: ToolRuntime<Record<string, unknown>, BashResult> = {
  id: 'bash',
  spec: buildBashTool(),
  async run(req, ctx: ToolRuntimeContext): Promise<BashResult> {
    // WD5 — cwd is pulled lazily from the session-working-dir module
    // when deps.cwd is unset. The caller can still pin an explicit
    // cwd via setBashRuntimeDeps({ cwd }), but the dashboard leaves
    // it unset so browser-pane Ctrl+W retargets Bash immediately.
    const cwd = deps?.cwd ?? getSessionCwd();
    const opts: BashToolOpts = { ...(deps ?? {}), cwd, signal: ctx.signal };
    // Track H — dashboard surface defaults to sandbox='auto' so
    // LLM-invoked Bash calls get sandbox-exec wrapping on macOS
    // unless the LLM explicitly opts out via `sandbox` on args.
    // Skill path keeps deps.sandbox as-is (usually undefined → off).
    if (ctx.surface === 'dashboard' && opts.sandbox === undefined && req.sandbox === undefined) {
      opts.sandbox = 'auto';
    }
    return dispatchBash(req, opts);
  },
};
