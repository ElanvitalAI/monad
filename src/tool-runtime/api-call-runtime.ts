// ── ApiCall ToolRuntime ──
//
// Wraps dispatchApiCall (src/skill-tool-api-call.ts) in the ToolRuntime
// shape.
//
//   • Host allowlist lives in its own module (listAllowed() / isAllowed())
//     and persists to ~/.config/monad-agent/api-allow.json. The
//     runtime doesn't carry or configure it; every surface reads the
//     same user-managed allowlist.
//
//   • Rate-limit token bucket is module-level state shared across
//     surfaces — one rate window per host, regardless of caller.
//
//   • No approver, no cwd.
//
//   • ctx.signal is composed with dispatchApiCall's internal timeout
//     AbortController so dashboard Esc can kill in-flight fetches.
//     Either source (outer abort or timeout) aborts the underlying
//     fetch; the dispatcher's error branch surfaces both the same way.

import { buildApiCallTool, dispatchApiCall, type ApiCallResult } from '../skills/tools/api-call.js';
import type { ToolRuntime, ToolRuntimeContext } from './types.js';

export const apiCallRuntime: ToolRuntime<Record<string, unknown>, ApiCallResult> = {
  id: 'api_call',
  spec: buildApiCallTool(),
  async run(req, ctx: ToolRuntimeContext) {
    return dispatchApiCall(req, { signal: ctx.signal });
  },
};
