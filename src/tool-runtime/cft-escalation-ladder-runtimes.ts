// ── PFC-S3.10: Escalation Ladder ToolRuntime wrapper ──

import {
  buildEscalateLadderTool,
  dispatchEscalateLadder,
  type EscalateLadderToolInput,
  type EscalateLadderToolResult,
} from '../cft/tools/escalate-ladder.js';
import type { ToolRuntime } from './types.js';

export const escalateLadderRuntime: ToolRuntime<EscalateLadderToolInput, EscalateLadderToolResult> = {
  id: 'escalate_ladder',
  spec: buildEscalateLadderTool(),
  async run(req) { return dispatchEscalateLadder(req); },
};

export const ALL_CFT_ESCALATION_LADDER_RUNTIMES = [
  escalateLadderRuntime,
] as const;
