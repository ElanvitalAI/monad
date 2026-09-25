// ── AgentList ToolRuntime adapter (PFC PX-1 Phase 6) ──
//
// Read-only. No approver, no sandbox. Follows the same pattern as
// input-policy-runtimes.ts and context-runtimes.ts.

import {
  buildAgentListTool,
  dispatchAgentList,
  type AgentListResult,
} from '../agent/agent-list-tool.js';
import type { ToolRuntime } from './types.js';

export const agentListRuntime: ToolRuntime<Record<string, unknown>, AgentListResult> = {
  id: 'agent_list',
  spec: buildAgentListTool(),
  async run(req) { return dispatchAgentList(req); },
};

export const ALL_AGENT_LIST_RUNTIMES: ToolRuntime<any, any>[] = [
  agentListRuntime,
];
