// ── PFC-S3.8: PDCA ToolRuntime wrapper ──

import {
  buildRunPDCATool,
  dispatchRunPDCA,
  type RunPDCAInput,
  type RunPDCAResult,
} from '../cft/tools/run-pdca.js';
import type { ToolRuntime } from './types.js';

export const runPdcaRuntime: ToolRuntime<RunPDCAInput, RunPDCAResult> = {
  id: 'run_pdca',
  spec: buildRunPDCATool(),
  async run(req) { return dispatchRunPDCA(req); },
};

export const ALL_CFT_PDCA_RUNTIMES = [
  runPdcaRuntime,
] as const;
