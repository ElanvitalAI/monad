// AskUserQuestion ToolRuntime wrapper — Phase WF1.
//
// Threads `ctx.sessionId` + `ctx.signal` through to the dispatcher so
// resolvers (notably the ACP `elanous/ask/*` bridge) can fan the request
// out to the peer attached to the calling session.

import { buildAskUserQuestionTool, dispatchAskUserQuestion } from '../ask-user-question/index.js';
import type { AskUserQuestionDispatchContext } from '../ask-user-question/tool.js';
import type { ToolRuntime } from './types.js';

export const askUserQuestionRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'ask_user_question',
  spec: buildAskUserQuestionTool(),
  async run(req, ctx) {
    const dispatchCtx: AskUserQuestionDispatchContext = {};
    if (ctx?.sessionId) dispatchCtx.sessionId = ctx.sessionId;
    if (ctx?.signal) dispatchCtx.signal = ctx.signal;
    const r = await dispatchAskUserQuestion(req, dispatchCtx);
    return { output: r.output };
  },
};
