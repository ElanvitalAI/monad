// ── Input-policy ToolRuntime adapters — Phase 6 ──
//
// Read-only + config-mutation. No approver, no sandbox, no signal
// forwarding. SetInputBinding writes an audit trail via the
// skill-tool-input-policy dispatcher itself; runtime layer stays
// mechanical.

import {
  buildSetInputModeTool,
  buildGetInputPolicyTool,
  buildSetInputBindingTool,
  dispatchSetInputMode,
  dispatchGetInputPolicy,
  dispatchSetInputBinding,
  type SetInputModeResult,
  type GetInputPolicyResult,
  type SetInputBindingResult,
} from '../skills/tools/input-policy.js';
import type { ToolRuntime } from './types.js';

export const setInputModeRuntime: ToolRuntime<Record<string, unknown>, SetInputModeResult> = {
  id: 'set_input_mode',
  spec: buildSetInputModeTool(),
  async run(req) { return dispatchSetInputMode(req); },
};

export const getInputPolicyRuntime: ToolRuntime<Record<string, unknown>, GetInputPolicyResult> = {
  id: 'get_input_policy',
  spec: buildGetInputPolicyTool(),
  async run(req) { return dispatchGetInputPolicy(req); },
};

export const setInputBindingRuntime: ToolRuntime<Record<string, unknown>, SetInputBindingResult> = {
  id: 'set_input_binding',
  spec: buildSetInputBindingTool(),
  async run(req) { return dispatchSetInputBinding(req); },
};

// NOTE: `any` in the type parameters mirrors ALL_CONTROL_RUNTIMES /
// ALL_CONTEXT_RUNTIMES / ALL_SHELL_RUNNER_RUNTIMES upstream. Runtime
// registration unions mixed-shape handlers; sticking with the same
// pattern keeps the register loop happy without per-runtime casts.
export const ALL_INPUT_POLICY_RUNTIMES: ToolRuntime<any, any>[] = [
  setInputModeRuntime,
  getInputPolicyRuntime,
  setInputBindingRuntime,
];
