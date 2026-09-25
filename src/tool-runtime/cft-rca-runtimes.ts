// ── PFC-S3.6 P4: RCA trio ToolRuntime wrappers ──

import {
  buildRootCauseAnalyzeTool,
  dispatchRootCauseAnalyze,
  type RootCauseAnalyzeInput,
  type RootCauseAnalyzeResult,
} from '../cft/tools/root-cause-analyze.js';
import {
  buildIshikawaAnalyzeTool,
  dispatchIshikawaAnalyze,
  type IshikawaAnalyzeInput,
  type IshikawaAnalyzeResult,
} from '../cft/tools/ishikawa-analyze.js';
import {
  buildParetoAnalyzeTool,
  dispatchParetoAnalyze,
  type ParetoAnalyzeInput,
  type ParetoAnalyzeResult,
} from '../cft/tools/pareto-analyze.js';
import type { ToolRuntime } from './types.js';

export const rootCauseAnalyzeRuntime: ToolRuntime<RootCauseAnalyzeInput, RootCauseAnalyzeResult> = {
  id: 'root_cause_analyze',
  spec: buildRootCauseAnalyzeTool(),
  async run(req) { return dispatchRootCauseAnalyze(req); },
};

export const ishikawaAnalyzeRuntime: ToolRuntime<IshikawaAnalyzeInput, IshikawaAnalyzeResult> = {
  id: 'ishikawa_analyze',
  spec: buildIshikawaAnalyzeTool(),
  async run(req) { return dispatchIshikawaAnalyze(req); },
};

export const paretoAnalyzeRuntime: ToolRuntime<ParetoAnalyzeInput, ParetoAnalyzeResult> = {
  id: 'pareto_analyze',
  spec: buildParetoAnalyzeTool(),
  async run(req) { return dispatchParetoAnalyze(req); },
};

export const ALL_CFT_RCA_RUNTIMES = [
  rootCauseAnalyzeRuntime,
  ishikawaAnalyzeRuntime,
  paretoAnalyzeRuntime,
] as const;
