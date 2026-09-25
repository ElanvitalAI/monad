import {
  buildBudgetStatusTool,
  buildBudgetHistoryTool,
  buildBudgetForecastTool,
  buildBudgetSetLimitTool,
  dispatchBudgetStatus,
  dispatchBudgetHistory,
  dispatchBudgetForecast,
  dispatchBudgetSetLimit,
} from '../skills/tools/budget.js';
import {
  buildPolicyDecideTool,
  buildPolicyExplainTool,
  dispatchPolicyDecide,
  dispatchPolicyExplain,
} from '../skills/tools/route.js';
import {
  buildAgentRoomComposeTool,
  buildAgentRoomListTool,
  buildAgentRoomCloseTool,
  dispatchAgentRoomCompose,
  dispatchAgentRoomList,
  dispatchAgentRoomClose,
} from '../skills/tools/agent-room.js';
import {
  buildLlmListNodesTool,
  buildLlmListAvailableModelsTool,
  dispatchLlmListNodes,
  dispatchLlmListAvailableModels,
} from '../skills/tools/llm-manager.js';
import {
  buildLlmRequestInstallTool,
  dispatchLlmRequestInstall,
} from '../skills/tools/llm-install.js';
import type { ToolRuntime } from './types.js';

export const budgetStatusRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'budget_status',
  spec: buildBudgetStatusTool(),
  async run(req) { return dispatchBudgetStatus(req); },
};

export const budgetHistoryRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'budget_history',
  spec: buildBudgetHistoryTool(),
  async run(req) { return dispatchBudgetHistory(req); },
};

export const budgetForecastRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'budget_forecast',
  spec: buildBudgetForecastTool(),
  async run(req) { return dispatchBudgetForecast(req); },
};

export const budgetSetLimitRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'budget_set_limit',
  spec: buildBudgetSetLimitTool(),
  async run(req) { return dispatchBudgetSetLimit(req); },
};

export const policyDecideRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'policy_decide',
  spec: buildPolicyDecideTool(),
  async run(req) { return dispatchPolicyDecide(req); },
};

export const policyExplainRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'policy_explain',
  spec: buildPolicyExplainTool(),
  async run(req) { return dispatchPolicyExplain(req); },
};

export const agentRoomComposeRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'agent_room_compose',
  spec: buildAgentRoomComposeTool(),
  async run(req) { return dispatchAgentRoomCompose(req); },
};

export const agentRoomListRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'agent_room_list',
  spec: buildAgentRoomListTool(),
  async run(req) { return dispatchAgentRoomList(req); },
};

export const agentRoomCloseRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'agent_room_close',
  spec: buildAgentRoomCloseTool(),
  async run(req) { return dispatchAgentRoomClose(req); },
};

export const llmListNodesRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'llm_list_nodes',
  spec: buildLlmListNodesTool(),
  async run(req) { return dispatchLlmListNodes(req); },
};

export const llmListAvailableModelsRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'llm_list_available_models',
  spec: buildLlmListAvailableModelsTool(),
  async run(req) { return dispatchLlmListAvailableModels(req); },
};

export const llmRequestInstallRuntime: ToolRuntime<Record<string, unknown>, any> = {
  id: 'llm_request_install',
  spec: buildLlmRequestInstallTool(),
  async run(req) { return dispatchLlmRequestInstall(req); },
};

export const ALL_OPS_FLEET_RUNTIMES: ReadonlyArray<ToolRuntime<any, any>> = [
  budgetStatusRuntime,
  budgetHistoryRuntime,
  budgetForecastRuntime,
  budgetSetLimitRuntime,
  policyDecideRuntime,
  policyExplainRuntime,
  agentRoomComposeRuntime,
  agentRoomListRuntime,
  agentRoomCloseRuntime,
  llmListNodesRuntime,
  llmListAvailableModelsRuntime,
  llmRequestInstallRuntime,
];
