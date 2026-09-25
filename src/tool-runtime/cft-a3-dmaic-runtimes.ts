// ── PFC-S3.7: A3 + DMAIC ToolRuntime wrappers ──

import {
  buildWriteA3Tool,
  dispatchWriteA3,
  type WriteA3Input,
  type WriteA3Result,
} from '../cft/tools/write-a3.js';
import {
  buildRunDMAICTool,
  dispatchRunDMAIC,
  type RunDMAICInput,
  type RunDMAICResult,
} from '../cft/tools/run-dmaic.js';
import type { ToolRuntime } from './types.js';

export const writeA3Runtime: ToolRuntime<WriteA3Input, WriteA3Result> = {
  id: 'write_a3',
  spec: buildWriteA3Tool(),
  async run(req) { return dispatchWriteA3(req); },
};

export const runDmaicRuntime: ToolRuntime<RunDMAICInput, RunDMAICResult> = {
  id: 'run_dmaic',
  spec: buildRunDMAICTool(),
  async run(req) { return dispatchRunDMAIC(req); },
};

export const ALL_CFT_A3_DMAIC_RUNTIMES = [
  writeA3Runtime,
  runDmaicRuntime,
] as const;
