// ── terminal_modal_{list,observe,spawn,focus,detach,kill} ToolRuntimes ──
//
// Thin wrappers that expose the existing dispatchers from
// `src/skill-tool-terminal-modal.ts` through the shared ToolRuntime
// registry so they light up on the `dashboard` surface as well as
// `skill`. All six are read-only or spawn-kind with the session
// registry already owning approval/lifecycle policy — the runtime
// just routes by id.

import {
  buildTerminalModalListTool,
  buildTerminalModalObserveTool,
  buildTerminalModalFocusTool,
  buildTerminalModalDetachTool,
  buildTerminalModalKillTool,
  dispatchTerminalModalList,
  dispatchTerminalModalObserve,
  dispatchTerminalModalFocus,
  dispatchTerminalModalDetach,
  dispatchTerminalModalKill,
} from '../skills/tools/terminal-modal.js';
import type { ToolRuntime } from './types.js';

/** Factory seams for `TerminalModalSpawn`/Focus/Detach/Kill that need
 *  current term dimensions at dispatch time. Dashboard boot wires
 *  these; skill/test callers pass their own via existing deps. */
interface TerminalModalDeps {
  termSize?: () => { cols: number; rows: number };
}

let deps: TerminalModalDeps = {};

export function setTerminalModalRuntimeDeps(next: TerminalModalDeps): void {
  deps = { ...next };
}

function dims() {
  if (deps.termSize) return deps.termSize();
  return { cols: 80, rows: 24 };
}

export const terminalModalListRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_list',
  spec: buildTerminalModalListTool(),
  async run(req) { return dispatchTerminalModalList(req); },
};

export const terminalModalObserveRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_observe',
  spec: buildTerminalModalObserveTool(),
  async run(req) { return dispatchTerminalModalObserve(req); },
};

// NT-C3 (session nt, 2026-04-18): terminalModalSpawnRuntime removed.
// TerminalModalSpawn was the LLM-triggered "open a PTY in a modal"
// tool. Session-nt replaces it with the VW-hosted runner (ShellRunner
// mode='vw', default). No alias is kept — LLMs should call RunShell
// once NT-C1b wires it in.

export const terminalModalFocusRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_focus',
  spec: buildTerminalModalFocusTool(),
  async run(req) {
    const { cols, rows } = dims();
    return dispatchTerminalModalFocus(req, { termCols: cols, termRows: rows });
  },
};

export const terminalModalDetachRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_detach',
  spec: buildTerminalModalDetachTool(),
  async run(req) { return dispatchTerminalModalDetach(req); },
};

export const terminalModalKillRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_modal_kill',
  spec: buildTerminalModalKillTool(),
  async run(req) { return dispatchTerminalModalKill(req); },
};

export const ALL_TERMINAL_MODAL_RUNTIMES: ToolRuntime<any, any>[] = [
  terminalModalListRuntime,
  terminalModalObserveRuntime,
  terminalModalFocusRuntime,
  terminalModalDetachRuntime,
  terminalModalKillRuntime,
];
