import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertDecomposeAbConfig,
  runDecomposeAb,
  summarizeDecomposeAb,
  type DecomposeAbConfig,
  type DecomposeAbRunner,
} from './lib/decompose-ab.js';
import type { SelfDevDecomposeLlm } from '../src/self-dev/decompose.js';

interface DecomposeAbLlmModule { llm?: SelfDevDecomposeLlm; default?: SelfDevDecomposeLlm }

export function readDecomposeAbConfig(env: NodeJS.ProcessEnv = process.env): DecomposeAbConfig {
  const corpusPath = env.DECOMPOSE_AB_CORPUS;
  if (!corpusPath) throw new Error('DECOMPOSE_AB_CORPUS is required; provide a corpus JSON path.');
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), corpusPath), 'utf8')) as Omit<DecomposeAbConfig, 'repeats' | 'treatment'> & {
    repeats?: number;
    treatment?: DecomposeAbConfig['treatment'];
  };
  const config: DecomposeAbConfig = {
    ...parsed,
    repeats: Number(env.DECOMPOSE_AB_REPEATS ?? parsed.repeats ?? 1),
    treatment: parsed.treatment ?? { anchor: env.DECOMPOSE_AB_ANCHOR ?? '', replacement: env.DECOMPOSE_AB_REPLACEMENT ?? '' },
  };
  assertDecomposeAbConfig(config);
  return config;
}

async function loadInjectedLlm(env: NodeJS.ProcessEnv): Promise<SelfDevDecomposeLlm> {
  const modulePath = env.DECOMPOSE_AB_LLM_MODULE;
  if (!modulePath) throw new Error('DECOMPOSE_AB_LLM_MODULE is required; the runner never uses the default LLM.');
  const loaded = await import(resolve(process.cwd(), modulePath)) as DecomposeAbLlmModule;
  const llm = loaded.llm ?? loaded.default;
  if (typeof llm !== 'function') throw new Error(`DECOMPOSE_AB_LLM_MODULE must export llm or default function: ${modulePath}`);
  return llm;
}

export async function main(
  env: NodeJS.ProcessEnv = process.env,
  readConfig: (env: NodeJS.ProcessEnv) => DecomposeAbConfig = readDecomposeAbConfig,
  loadLlm: (env: NodeJS.ProcessEnv) => Promise<SelfDevDecomposeLlm> = loadInjectedLlm,
  argv: readonly string[] = process.argv.slice(2),
  runner?: DecomposeAbRunner,
): Promise<void> {
  if (argv.length > 0) throw new Error('measure-decompose-ab accepts no positional arguments; use DECOMPOSE_AB_* environment variables.');
  const config = readConfig(env);
  const llm = await loadLlm(env);
  const records = await runDecomposeAb(config, llm, runner);
  const summary = summarizeDecomposeAb(config, records);
  const output = { config, records, summary };
  const out = env.DECOMPOSE_AB_OUT;
  if (out) writeFileSync(resolve(process.cwd(), out), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`[decompose-ab] ${config.corpus.length} items × ${config.repeats} repeats × 2 arms = ${summary.records}/${summary.expectedRecords} attempts; observed ${summary.observedRecords}; unmeasured ${summary.unmeasuredRecords}; complete pairs ${summary.pairs.length}; incomplete pairs ${summary.incompletePairs.length}`);
  for (const arm of ['control', 'treatment'] as const) {
    const result = summary.byArm[arm];
    console.log(`[decompose-ab] ${arm} decomposed ${result.decompositionRate.passes}/${result.decompositionRate.runs} · 2+ tasks ${result.multiTaskRate.passes}/${result.multiTaskRate.runs} · expected ${result.expectedRecords}; observed ${result.observedRecords}; unmeasured ${result.unmeasuredRecords} · outcomes ${JSON.stringify(result.outcomes)} · mean tasks ${result.meanTaskCount.toFixed(2)}`);
  }
  console.log(`[decompose-ab] negative controls ${summary.negativeControls.length}; over-split ${summary.negativeControls.filter((control) => control.overSplit).length}; rounds ${summary.rounds.map((round) => `${round.repeat}:${round.controlDecomposed}/${round.treatmentDecomposed}`).join(', ')}`);
  if (out) console.log(`[decompose-ab] JSON ${resolve(process.cwd(), out)}`);
}

if (import.meta.main) await main();
