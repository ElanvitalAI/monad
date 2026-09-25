// ── PFC-S3.9: Quick-Kill ToolRuntime wrapper ──

import {
  buildQuickKillTriageTool,
  dispatchQuickKillTriage,
  type QuickKillTriageInput,
  type QuickKillTriageResult,
} from '../cft/tools/quick-kill-triage.js';
import type { ToolRuntime } from './types.js';

export const quickKillTriageRuntime: ToolRuntime<QuickKillTriageInput, QuickKillTriageResult> = {
  id: 'quick_kill_triage',
  spec: buildQuickKillTriageTool(),
  async run(req) { return dispatchQuickKillTriage(req); },
};

export const ALL_CFT_QUICK_KILL_RUNTIMES = [
  quickKillTriageRuntime,
] as const;
