// ── PFC-S3.4 P2: FMEA ToolRuntime wrapper ──

import {
  buildRunFMEATool,
  dispatchRunFMEA,
  type RunFMEAInput,
  type RunFMEAResult,
} from '../cft/tools/run-fmea.js';
import type { ToolRuntime } from './types.js';

export const runFMEARuntime: ToolRuntime<RunFMEAInput, RunFMEAResult> = {
  id: 'run_fmea',
  spec: buildRunFMEATool(),
  async run(req) { return dispatchRunFMEA(req); },
};

export const ALL_CFT_FMEA_RUNTIMES = [
  runFMEARuntime,
] as const;
