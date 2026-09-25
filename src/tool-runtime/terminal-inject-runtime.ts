// ── TerminalModalInject ToolRuntime ──
//
// Migrates the `TerminalModalInject` native tool to the ToolRuntime
// registry (DESIGN-pty-llm-native-promotion.md §3B follow-up). Natural
// fit because the tool already uses an approver pattern — the
// runtime just has to carry the approver into dispatchTerminalModalInject.
//
// Approver DI:
//
//   • The tool's approver shape (`InjectApprovalRequest`) is
//     tool-specific, so it does NOT fit into ToolRuntimeContext.approver
//     (which is the generic `{cmd, args, cwd}` shape for PTY spawn).
//
//   • Instead the runtime holds a module-level reference to an approver,
//     set once at dashboard boot via setTerminalInjectApprover().
//     skill-runner keeps its existing direct-dispatch path (which
//     creates a fresh approver per call via createInjectApprover()).
//
//   • If the runtime fires before the setter is called (tests,
//     mis-initialized host), dispatchTerminalModalInject's own
//     fail-closed guard rejects with a helpful message.

import {
  buildTerminalModalInjectTool,
  dispatchTerminalModalInject,
  type InjectApprovalRequest,
} from '../skills/tools/terminal-modal-inject.js';
import type { TerminalSessionRegistry } from '../terminal/session-registry.js';
import type { ToolRuntime } from './types.js';

type InjectApprover = (req: InjectApprovalRequest) => Promise<boolean>;

let approverRef: InjectApprover | null = null;
let registryOverride: TerminalSessionRegistry | null = null;
let chunkDelayOverride: number | null = null;

/** Wire the approver the runtime will consult on every dispatch. Call
 *  once at dashboard boot (after initDashboardApprovers). Passing null
 *  un-sets — tests can toggle between auto-approve and reject. */
export function setTerminalInjectApprover(a: InjectApprover | null): void {
  approverRef = a;
}

/** Test seam — inject a fake session registry so unit tests can drive
 *  the runtime without standing up the full dashboard. Defaults to
 *  getDashboardTerminalSessions() when null. */
export function setTerminalInjectRegistryForTesting(
  r: TerminalSessionRegistry | null,
): void {
  registryOverride = r;
}

/** Test seam — force chunk delay to 0 ms so dispatch tests don't
 *  accrue their 10ms-per-chunk baseline into test runtime. */
export function setTerminalInjectChunkDelayForTesting(ms: number | null): void {
  chunkDelayOverride = ms;
}

/** Test helper — inspect the current approver binding. */
export function _getTerminalInjectApproverForTesting(): InjectApprover | null {
  return approverRef;
}

export const terminalInjectRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_inject',
  spec: buildTerminalModalInjectTool(),
  async run(req) {
    // Pass undefined (not null) when unset so the dispatcher's
    // fail-closed branch fires with its own wording.
    return dispatchTerminalModalInject(req, {
      approver: approverRef ?? undefined,
      registry: registryOverride ?? undefined,
      ...(chunkDelayOverride !== null ? { chunkDelayMs: chunkDelayOverride } : {}),
    });
  },
};
