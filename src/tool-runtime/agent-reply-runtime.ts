import {
  buildAgentReplyTool,
  dispatchAgentReply,
  type AgentReplyResult,
} from '../skills/tools/agent-reply.js';
import type { ToolRuntime } from './types.js';

export const agentReplyRuntime: ToolRuntime<Record<string, unknown>, AgentReplyResult> = {
  id: 'agent_reply',
  spec: buildAgentReplyTool(),
  async run(req) {
    return await dispatchAgentReply(req);
  },
};
