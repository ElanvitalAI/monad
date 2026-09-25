import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { streamLLM } from '../src/llm.js';
import { gradePhaseCompletability } from '../src/autopilot/mission-phase-granularity.js';
import {
  decomposeSelfDevGoal,
  FabricDecompositionRejectedError,
  type SelfDevDecomposeLlm,
  type SelfDevDecomposition,
} from '../src/self-dev/decompose.js';

export interface DecomposerPromotionCorpusItem {
  id: string;
  feature: string;
  groundingContext: string;
}

export interface DecomposerPromotionAbConfig {
  corpus: readonly DecomposerPromotionCorpusItem[];
  maxTasks?: number;
  out: string;
}

export interface ResolvedDecomposerConditions {
  model: string;
  resolver: string;
  llm: SelfDevDecomposeLlm;
}

export interface DecomposerPromotionAbDependencies {
  resolveConditions: (env: NodeJS.ProcessEnv) => Promise<ResolvedDecomposerConditions>;
  decompose: typeof decomposeSelfDevGoal;
  writeOutput: (line: string) => void;
  writeJson: (path: string, output: DecomposerPromotionAbOutput) => void;
}

export interface DecomposerQuality {
  taskCount: number;
  oversizedTaskCount: number;
}

export type DecomposerPromotionPair = {
  id: string;
  feature: string;
  status: 'measured';
  default: DecomposerQuality;
  fabric: DecomposerQuality;
  qualityDelta: { taskCount: number; oversizedTaskCount: number };
} | {
  id: string;
  feature: string;
  status: 'fabric-rejected';
  default: DecomposerQuality;
  fabricRejection: string;
} | {
  id: string;
  feature: string;
  status: 'incomplete';
  failedArm: 'default' | 'fabric';
  error: string;
};

export interface DecomposerPromotionAbSummary {
  requestedPairs: number;
  measuredPairs: number;
  fabricRejectedPairs: number;
  incompletePairs: number;
  quality: {
    defaultTaskCount: number;
    fabricTaskCount: number;
    defaultOversizedTaskCount: number;
    fabricOversizedTaskCount: number;
    taskCountDelta: number;
    oversizedTaskCountDelta: number;
  } | null;
}

export interface DecomposerPromotionAbOutput {
  config: Omit<DecomposerPromotionAbConfig, 'out'> & { out: string };
  conditions: { model: string; resolver: string; identicalAcrossArms: true };
  pairs: DecomposerPromotionPair[];
  summary: DecomposerPromotionAbSummary;
}

export function readDecomposerPromotionAbConfig(env: NodeJS.ProcessEnv = process.env): DecomposerPromotionAbConfig {
  const corpusPath = env.DECOMPOSER_PROMOTION_AB_CORPUS?.trim();
  if (!corpusPath) throw new Error('DECOMPOSER_PROMOTION_AB_CORPUS is required; provide a corpus JSON path.');
  const out = env.DECOMPOSER_PROMOTION_AB_OUT?.trim();
  if (!out) throw new Error('DECOMPOSER_PROMOTION_AB_OUT is required; provide a JSON result path.');
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), corpusPath), 'utf8')) as Omit<DecomposerPromotionAbConfig, 'out'>;
  const config = { ...parsed, out, ...(env.DECOMPOSER_PROMOTION_AB_MAX_TASKS === undefined ? {} : { maxTasks: Number(env.DECOMPOSER_PROMOTION_AB_MAX_TASKS) }) };
  assertDecomposerPromotionAbConfig(config);
  return config;
}

export function assertDecomposerPromotionAbConfig(config: DecomposerPromotionAbConfig): void {
  if (!Array.isArray(config.corpus) || config.corpus.length === 0) throw new Error('corpus must contain at least one item');
  if (!config.out.trim()) throw new Error('out must be non-empty');
  if (config.maxTasks !== undefined && (!Number.isInteger(config.maxTasks) || config.maxTasks <= 0)) throw new Error('maxTasks must be a positive integer');
  const ids = new Set<string>();
  for (const item of config.corpus) {
    if (!item.id.trim() || !item.feature.trim()) throw new Error('each corpus item requires non-empty id and feature');
    if (!item.groundingContext.trim()) throw new Error(`corpus item ${item.id} requires non-empty groundingContext for fabric decomposition`);
    if (ids.has(item.id)) throw new Error(`corpus id must be unique: ${item.id}`);
    ids.add(item.id);
  }
}

function quality(result: SelfDevDecomposition): DecomposerQuality {
  return {
    taskCount: result.goals.length,
    oversizedTaskCount: result.goals.filter((goal) => gradePhaseCompletability({
      id: goal.id ?? '', title: goal.feature ?? '', prompt: goal.feature ?? '', acceptance: [],
    }).verdict === 'too_large').length,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function summarizeDecomposerPromotionAb(
  requestedPairs: number,
  pairs: readonly DecomposerPromotionPair[],
): DecomposerPromotionAbSummary {
  const measured = pairs.filter((pair): pair is Extract<DecomposerPromotionPair, { status: 'measured' }> => pair.status === 'measured');
  const rejected = pairs.filter((pair) => pair.status === 'fabric-rejected').length;
  const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);
  return {
    requestedPairs,
    measuredPairs: measured.length,
    fabricRejectedPairs: rejected,
    incompletePairs: pairs.length - measured.length - rejected,
    quality: measured.length === 0 ? null : {
      defaultTaskCount: total(measured.map((pair) => pair.default.taskCount)),
      fabricTaskCount: total(measured.map((pair) => pair.fabric.taskCount)),
      defaultOversizedTaskCount: total(measured.map((pair) => pair.default.oversizedTaskCount)),
      fabricOversizedTaskCount: total(measured.map((pair) => pair.fabric.oversizedTaskCount)),
      taskCountDelta: total(measured.map((pair) => pair.qualityDelta.taskCount)),
      oversizedTaskCountDelta: total(measured.map((pair) => pair.qualityDelta.oversizedTaskCount)),
    },
  };
}

async function measurePair(
  item: DecomposerPromotionCorpusItem,
  conditions: ResolvedDecomposerConditions,
  maxTasks: number | undefined,
  decompose: typeof decomposeSelfDevGoal,
): Promise<DecomposerPromotionPair> {
  let defaultResult: SelfDevDecomposition;
  try {
    defaultResult = await decompose(item.feature, { llm: conditions.llm, model: conditions.model, ...(maxTasks === undefined ? {} : { maxTasks }) });
  } catch (error) {
    return { id: item.id, feature: item.feature, status: 'incomplete', failedArm: 'default', error: errorMessage(error) };
  }
  const defaultQuality = quality(defaultResult);
  try {
    const fabricResult = await decompose(item.feature, {
      decomposer: 'fabric', llm: conditions.llm, model: conditions.model,
      fabric: { context: { goal: item.feature, groundingContext: item.groundingContext }, resolve: conditions.llm },
      ...(maxTasks === undefined ? {} : { maxTasks }),
    });
    const fabricQuality = quality(fabricResult);
    return {
      id: item.id, feature: item.feature, status: 'measured', default: defaultQuality, fabric: fabricQuality,
      qualityDelta: {
        taskCount: fabricQuality.taskCount - defaultQuality.taskCount,
        oversizedTaskCount: fabricQuality.oversizedTaskCount - defaultQuality.oversizedTaskCount,
      },
    };
  } catch (error) {
    if (error instanceof FabricDecompositionRejectedError) {
      return { id: item.id, feature: item.feature, status: 'fabric-rejected', default: defaultQuality, fabricRejection: error.result.status };
    }
    return { id: item.id, feature: item.feature, status: 'incomplete', failedArm: 'fabric', error: errorMessage(error) };
  }
}

async function liveConditions(env: NodeJS.ProcessEnv): Promise<ResolvedDecomposerConditions> {
  const model = env.DECOMPOSER_PROMOTION_AB_MODEL?.trim() || process.env.MONAD_PR_REVIEW_MODEL || 'gpt-5.6-sol';
  const llm: SelfDevDecomposeLlm = (prompt) => streamLLM([{ role: 'user', content: prompt }], () => {}, { model, reasoningEffort: 'low' });
  return { model, resolver: 'shared-streamLLM', llm };
}

export function loadLiveDecomposerPromotionAbDependencies(): DecomposerPromotionAbDependencies {
  return {
    resolveConditions: liveConditions,
    decompose: decomposeSelfDevGoal,
    writeOutput: console.log,
    writeJson: (path, output) => writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, 'utf8'),
  };
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: (env: NodeJS.ProcessEnv) => DecomposerPromotionAbConfig = readDecomposerPromotionAbConfig,
  dependencies: DecomposerPromotionAbDependencies = loadLiveDecomposerPromotionAbDependencies(),
  argv: readonly string[] = process.argv.slice(2),
): Promise<DecomposerPromotionAbOutput> {
  if (argv.length > 0) throw new Error('measure-decomposer-promotion-ab accepts no positional arguments; use DECOMPOSER_PROMOTION_AB_* environment variables.');
  const config = readConfig(env);
  assertDecomposerPromotionAbConfig(config);
  const conditions = await dependencies.resolveConditions(env);
  if (!conditions.model.trim() || !conditions.resolver.trim() || typeof conditions.llm !== 'function') throw new Error('resolved conditions require non-empty model, resolver, and llm');
  const pairs: DecomposerPromotionPair[] = [];
  for (const item of config.corpus) pairs.push(await measurePair(item, conditions, config.maxTasks, dependencies.decompose));
  const output: DecomposerPromotionAbOutput = {
    config,
    conditions: { model: conditions.model, resolver: conditions.resolver, identicalAcrossArms: true },
    pairs,
    summary: summarizeDecomposerPromotionAb(config.corpus.length, pairs),
  };
  const out = resolve(process.cwd(), config.out);
  dependencies.writeJson(out, output);
  dependencies.writeOutput(`[decomposer-promotion-ab] ${output.summary.measuredPairs}/${output.summary.requestedPairs} measured; rejected ${output.summary.fabricRejectedPairs}; incomplete ${output.summary.incompletePairs}; model ${conditions.model}; resolver ${conditions.resolver}`);
  dependencies.writeOutput(`[decomposer-promotion-ab] JSON ${out}`);
  return output;
}

if (import.meta.main) await main();
