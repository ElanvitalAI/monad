// ── Team tool runtimes (PFC-S1 P4) ──
//
// Registers TeamCreate / TeamDelete / SendMessage with the tool-runtime
// layer so they appear alongside other native tools in the runtime
// catalog. Dispatchers live in src/agent-team/team-tools.ts; this file
// is a thin adapter — same pattern as agent-list-runtimes.ts.

import {
  buildTeamCreateTool, dispatchTeamCreate,
  buildTeamDeleteTool, dispatchTeamDelete,
  buildSendMessageTool, dispatchSendMessage,
  type TeamCreateResult, type TeamDeleteResult, type SendMessageResult,
} from '../agent-team/team-tools.js';
import type { ToolRuntime } from './types.js';

export const teamCreateRuntime: ToolRuntime<Record<string, unknown>, TeamCreateResult> = {
  id: 'team_create',
  spec: buildTeamCreateTool(),
  async run(req) { return dispatchTeamCreate(req); },
};

export const teamDeleteRuntime: ToolRuntime<Record<string, unknown>, TeamDeleteResult> = {
  id: 'team_delete',
  spec: buildTeamDeleteTool(),
  async run(req) { return dispatchTeamDelete(req); },
};

export const sendMessageRuntime: ToolRuntime<Record<string, unknown>, SendMessageResult> = {
  id: 'send_message',
  spec: buildSendMessageTool(),
  async run(req) { return dispatchSendMessage(req); },
};

export const ALL_TEAM_TOOL_RUNTIMES: ToolRuntime<any, any>[] = [
  teamCreateRuntime,
  teamDeleteRuntime,
  sendMessageRuntime,
];
