// ── PFC-S3.1 P3: Andon ToolRuntime wrappers ──

import {
  buildEscalateSignalTool,
  dispatchEscalateSignal,
  type EscalateSignalInput,
  type EscalateSignalResult,
} from '../cft/tools/escalate-signal.js';
import {
  buildResolveEscalationTool,
  dispatchResolveEscalation,
  type ResolveEscalationInput,
  type ResolveEscalationResult,
} from '../cft/tools/resolve-escalation.js';
import {
  buildAndonListTool,
  dispatchAndonList,
  type AndonListInput,
  type AndonListToolResult,
} from '../cft/tools/andon-list.js';
import type { ToolRuntime } from './types.js';

export const escalateSignalRuntime: ToolRuntime<EscalateSignalInput, EscalateSignalResult> = {
  id: 'escalate_signal',
  spec: buildEscalateSignalTool(),
  async run(req) { return dispatchEscalateSignal(req); },
};

export const resolveEscalationRuntime: ToolRuntime<ResolveEscalationInput, ResolveEscalationResult> = {
  id: 'resolve_escalation',
  spec: buildResolveEscalationTool(),
  async run(req) { return dispatchResolveEscalation(req); },
};

export const andonListRuntime: ToolRuntime<AndonListInput, AndonListToolResult> = {
  id: 'andon_list',
  spec: buildAndonListTool(),
  async run(req) { return dispatchAndonList(req); },
};

export const ALL_CFT_ANDON_RUNTIMES = [
  escalateSignalRuntime,
  resolveEscalationRuntime,
  andonListRuntime,
] as const;
