// ── PFC-S3.2 P3: SPC ToolRuntime wrapper ──

import {
  buildEmitProcessHealthTool,
  dispatchEmitProcessHealth,
  type EmitProcessHealthInput,
  type EmitProcessHealthResult,
} from '../cft/tools/emit-process-health.js';
import type { ToolRuntime } from './types.js';

export const emitProcessHealthRuntime: ToolRuntime<EmitProcessHealthInput, EmitProcessHealthResult> = {
  id: 'emit_process_health',
  spec: buildEmitProcessHealthTool(),
  async run(req) { return dispatchEmitProcessHealth(req); },
};

export const ALL_CFT_SPC_RUNTIMES = [
  emitProcessHealthRuntime,
] as const;
