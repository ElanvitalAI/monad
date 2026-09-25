// ── terminal_matrix_* ToolRuntimes (Phase T8a) ──
//
// Thin wrappers so the T1-T7 matrix APIs are reachable through the
// shared ToolRuntime registry on both `skill` and `dashboard`
// surfaces. The catalog's surface field ships both, matching the
// session-d fix that surfaced terminal_modal_* on dashboard too.

import {
  buildTerminalMatrixListTool, dispatchTerminalMatrixList,
  buildTerminalMatrixMoveTool, dispatchTerminalMatrixMove,
  buildTerminalMatrixSpawnTool, dispatchTerminalMatrixSpawn,
  buildTerminalBroadcastSendTool, dispatchTerminalBroadcastSend,
  buildTerminalMatrixGroupJoinTool, dispatchTerminalMatrixGroupJoin,
  buildTerminalMatrixGroupLeaveTool, dispatchTerminalMatrixGroupLeave,
  buildTerminalChannelPublishTool, dispatchTerminalChannelPublish,
  buildTerminalReadonlySetTool, dispatchTerminalReadonlySet,
  buildTerminalRecharacterTool, dispatchTerminalRecharacter,
  buildTerminalPipeToChannelTool, dispatchTerminalPipeToChannel,
  buildTerminalUnpipeFromChannelTool, dispatchTerminalUnpipeFromChannel,
  buildTerminalPipeListTool, dispatchTerminalPipeList,
} from '../skills/tools/terminal-matrix.js';
import type { ToolRuntime } from './types.js';

export const terminalMatrixListRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_matrix_list',
  spec: buildTerminalMatrixListTool(),
  async run(req) { return dispatchTerminalMatrixList(req); },
};

export const terminalMatrixMoveRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_matrix_move',
  spec: buildTerminalMatrixMoveTool(),
  async run(req) { return dispatchTerminalMatrixMove(req); },
};

export const terminalMatrixSpawnRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_matrix_spawn',
  spec: buildTerminalMatrixSpawnTool(),
  async run(req) { return dispatchTerminalMatrixSpawn(req); },
};

export const terminalBroadcastSendRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_broadcast_send',
  spec: buildTerminalBroadcastSendTool(),
  async run(req) { return dispatchTerminalBroadcastSend(req); },
};

export const terminalMatrixGroupJoinRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_matrix_group_join',
  spec: buildTerminalMatrixGroupJoinTool(),
  async run(req) { return dispatchTerminalMatrixGroupJoin(req); },
};

export const terminalMatrixGroupLeaveRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_matrix_group_leave',
  spec: buildTerminalMatrixGroupLeaveTool(),
  async run(req) { return dispatchTerminalMatrixGroupLeave(req); },
};

export const terminalChannelPublishRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_channel_publish',
  spec: buildTerminalChannelPublishTool(),
  async run(req) { return dispatchTerminalChannelPublish(req); },
};

export const terminalReadonlySetRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_readonly_set',
  spec: buildTerminalReadonlySetTool(),
  async run(req) { return dispatchTerminalReadonlySet(req); },
};

export const terminalRecharacterRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_recharacter',
  spec: buildTerminalRecharacterTool(),
  async run(req) { return dispatchTerminalRecharacter(req); },
};

export const terminalPipeToChannelRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_pipe_to_channel',
  spec: buildTerminalPipeToChannelTool(),
  async run(req) { return dispatchTerminalPipeToChannel(req); },
};

export const terminalUnpipeFromChannelRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_unpipe_from_channel',
  spec: buildTerminalUnpipeFromChannelTool(),
  async run(req) { return dispatchTerminalUnpipeFromChannel(req); },
};

export const terminalPipeListRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'terminal_pipe_list',
  spec: buildTerminalPipeListTool(),
  async run() { return dispatchTerminalPipeList(); },
};

export const ALL_TERMINAL_MATRIX_RUNTIMES: ToolRuntime<any, any>[] = [
  terminalMatrixListRuntime,
  terminalMatrixMoveRuntime,
  terminalMatrixSpawnRuntime,
  terminalBroadcastSendRuntime,
  terminalMatrixGroupJoinRuntime,
  terminalMatrixGroupLeaveRuntime,
  terminalChannelPublishRuntime,
  terminalReadonlySetRuntime,
  terminalRecharacterRuntime,
  terminalPipeToChannelRuntime,
  terminalUnpipeFromChannelRuntime,
  terminalPipeListRuntime,
];
