// AXON P5 — ToolRuntime wrapper for AnnounceCompletion.

import {
  buildAnnounceCompletionTool,
  dispatchAnnounceCompletion,
  type AnnounceCompletionArgs,
} from '../skills/tools/announce-completion.js';
import type { ToolRuntime } from './types.js';

export const announceCompletionRuntime: ToolRuntime<AnnounceCompletionArgs, any> = {
  id: 'announce_completion',
  spec: buildAnnounceCompletionTool(),
  async run(req) {
    return dispatchAnnounceCompletion(req);
  },
};
