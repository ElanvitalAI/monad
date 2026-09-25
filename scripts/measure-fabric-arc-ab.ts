import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { streamLLM } from '../src/llm.js';
import { groundGoalAuthoringContext, type GoalAuthoringGroundingResult } from '../src/self-implement/goal-authoring-grounding.js';
import { decomposeSelfDevGoal, type SelfDevDecomposeLlm } from '../src/self-dev/decompose.js';
import type {
  FabricDecomposeGoal,
  FabricDecomposeGround,
  FabricDecomposeResolve,
} from '../src/self-dev/fabric-decompose-adapter.js';
import { observeFabricArcAb, type FabricArcObserveAbResult } from './lib/fabric-arc-observe-ab.js';

export interface FabricArcAbConfig {
  request: string;
  withoutLines: number;
  out: string;
}

export interface FabricArcAbDependencies {
  ground: FabricDecomposeGround;
  resolve: FabricDecomposeResolve;
  decomposeGoal: FabricDecomposeGoal;
  writeOutput: (line: string) => void;
  writeJson: (path: string, output: FabricArcAbOutput) => void;
}

export interface FabricArcAbOutput {
  config: FabricArcAbConfig;
  observation: FabricArcObserveAbResult;
}

export function readFabricArcAbConfig(env: NodeJS.ProcessEnv = process.env): FabricArcAbConfig {
  const request = env.FABRIC_ARC_AB_REQUEST?.trim();
  if (!request) throw new Error('FABRIC_ARC_AB_REQUEST is required.');
  const out = env.FABRIC_ARC_AB_OUT?.trim();
  if (!out) throw new Error('FABRIC_ARC_AB_OUT is required; provide a JSON result path.');
  const withoutLines = Number(env.FABRIC_ARC_AB_WITHOUT_LINES ?? '3');
  if (!Number.isInteger(withoutLines) || withoutLines < 0) {
    throw new Error('FABRIC_ARC_AB_WITHOUT_LINES must be a non-negative integer.');
  }
  return { request, withoutLines, out };
}

function defaultResolve(prompt: string): Promise<string> {
  const model = process.env.MONAD_PR_REVIEW_MODEL || 'gpt-5.6-sol';
  return streamLLM([{ role: 'user', content: prompt }], () => {}, { model, reasoningEffort: 'low' });
}

export function loadLiveFabricArcAbDependencies(): FabricArcAbDependencies {
  return {
    ground: groundGoalAuthoringContext,
    resolve: defaultResolve as SelfDevDecomposeLlm,
    decomposeGoal: decomposeSelfDevGoal,
    writeOutput: console.log,
    writeJson: (path, output) => writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, 'utf8'),
  };
}

function withDocumentLines(grounding: GoalAuthoringGroundingResult, documentLines: readonly string[]): GoalAuthoringGroundingResult {
  return { ...grounding, documentLines };
}

export function renderFabricArcAbTable(observation: FabricArcObserveAbResult): string {
  const rows = [
    ['without-grounding', observation.withoutGrounding],
    ['with-grounding', observation.withGrounding],
  ] as const;
  return [
    '| condition | status | goals | dependency edges | specificity score |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows.map(([condition, result]) => `| ${condition} | ${result.status} | ${result.goalCount} | ${result.dependencyEdges} | ${result.specificity.score} |`),
  ].join('\n');
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: (env: NodeJS.ProcessEnv) => FabricArcAbConfig = readFabricArcAbConfig,
  dependencies: FabricArcAbDependencies = loadLiveFabricArcAbDependencies(),
  argv: readonly string[] = process.argv.slice(2),
): Promise<FabricArcAbOutput> {
  if (argv.length > 0) throw new Error('measure-fabric-arc-ab accepts no positional arguments; use FABRIC_ARC_AB_* environment variables.');
  const config = readConfig(env);
  const grounding = await dependencies.ground(config.request);
  const observation = await observeFabricArcAb({
    request: config.request,
    withoutGrounding: async () => withDocumentLines(grounding, grounding.documentLines.slice(0, config.withoutLines)),
    withGrounding: async () => grounding,
    resolve: dependencies.resolve,
    decomposeGoal: dependencies.decomposeGoal,
  });
  const output = { config, observation };
  const out = resolve(process.cwd(), config.out);
  dependencies.writeJson(out, output);
  dependencies.writeOutput(renderFabricArcAbTable(observation));
  dependencies.writeOutput(`[fabric-arc-ab] JSON ${out}`);
  return output;
}

if (import.meta.main) await main();
