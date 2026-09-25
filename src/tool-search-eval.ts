// Search tool evaluation fixtures and runner.
//
// Generates a synthetic TypeScript corpus with known ground truth, then compares
// plain text search (`rg`) with structural search (`ast-grep`). The scenarios
// are intentionally mixed with comments and strings so accuracy differences are
// measurable instead of anecdotal.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dispatchAstGrep, hasAstGrep } from './skills/tools/ast-grep.js';

export type SearchEvalComplexity = 'small' | 'medium' | 'large';
export type SearchEngineName = 'rg' | 'ast-grep';

export interface SearchEvalScenario {
  id: string;
  description: string;
  rgPattern: string;
  astPattern: string;
  astLang: string;
  truth: Set<string>;
}

export interface SearchEvalFixture {
  root: string;
  complexity: SearchEvalComplexity;
  fileCount: number;
  scenarios: SearchEvalScenario[];
}

export interface SearchEvalMetrics {
  engine: SearchEngineName;
  scenarioId: string;
  available: boolean;
  elapsedMs: number;
  matchedFiles: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  error?: string;
}

export interface SearchEvalResult {
  fixture: {
    root: string;
    complexity: SearchEvalComplexity;
    fileCount: number;
  };
  metrics: SearchEvalMetrics[];
}

const COMPLEXITY_SCALE: Record<SearchEvalComplexity, number> = {
  small: 4,
  medium: 40,
  large: 160,
};

export function createSearchEvalFixture(
  root: string,
  opts: { complexity?: SearchEvalComplexity } = {},
): SearchEvalFixture {
  const complexity = opts.complexity ?? 'small';
  const scale = COMPLEXITY_SCALE[complexity];
  const scenarios = [
    makeConsoleScenario(root, scale),
    makeAwaitFetchScenario(root, scale),
  ];
  const fileCount = scenarios.reduce((sum, scenario) => sum + scenario.truth.size * 3, 0);
  return { root, complexity, fileCount, scenarios };
}

export async function runSearchEval(
  opts: { complexity?: SearchEvalComplexity; root?: string; keepFixture?: boolean } = {},
): Promise<SearchEvalResult> {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'monad-search-eval-'));
  const fixture = createSearchEvalFixture(root, { complexity: opts.complexity });
  try {
    const metrics: SearchEvalMetrics[] = [];
    for (const scenario of fixture.scenarios) {
      metrics.push(runRgScenario(fixture, scenario));
      metrics.push(await runAstGrepScenario(fixture, scenario));
    }
    return {
      fixture: {
        root,
        complexity: fixture.complexity,
        fileCount: fixture.fileCount,
      },
      metrics,
    };
  } finally {
    if (!opts.root && !opts.keepFixture) rmSync(root, { recursive: true, force: true });
  }
}

export function renderSearchEvalMarkdown(result: SearchEvalResult): string {
  const lines = [
    '# Search Tool Evaluation',
    '',
    `- Fixture: ${result.fixture.root}`,
    `- Complexity: ${result.fixture.complexity}`,
    `- Generated files: ${result.fixture.fileCount}`,
    '',
    '| scenario | engine | available | ms | precision | recall | f1 | tp | fp | fn |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const metric of result.metrics) {
    lines.push([
      metric.scenarioId,
      metric.engine,
      String(metric.available),
      metric.elapsedMs.toFixed(2),
      metric.precision.toFixed(3),
      metric.recall.toFixed(3),
      metric.f1.toFixed(3),
      String(metric.truePositives),
      String(metric.falsePositives),
      String(metric.falseNegatives),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  const errors = result.metrics.filter(metric => metric.error);
  if (errors.length) {
    lines.push('', '## Errors', '');
    for (const error of errors) lines.push(`- ${error.engine}/${error.scenarioId}: ${error.error}`);
  }
  return lines.join('\n');
}

function makeConsoleScenario(root: string, scale: number): SearchEvalScenario {
  const dir = join(root, 'console');
  mkdirSync(dir, { recursive: true });
  const truth = new Set<string>();
  for (let i = 0; i < scale; i++) {
    const real = `console/real-console-${i}.ts`;
    write(root, real, [
      `export function realConsole${i}(value: unknown) {`,
      '  console.log(value);',
      '}',
      '',
    ]);
    truth.add(real);
    write(root, `console/comment-decoy-${i}.ts`, [
      `export function commentDecoy${i}(value: unknown) {`,
      '  // console.log(value) should not count as a call',
      '  return value;',
      '}',
      '',
    ]);
    write(root, `console/string-decoy-${i}.ts`, [
      `export function stringDecoy${i}() {`,
      '  return "console.log(value)";',
      '}',
      '',
    ]);
  }
  return {
    id: 'console_call',
    description: 'Find real console.log calls while ignoring comments and string literals.',
    rgPattern: 'console.log',
    astPattern: 'console.log($ARG)',
    astLang: 'typescript',
    truth,
  };
}

function makeAwaitFetchScenario(root: string, scale: number): SearchEvalScenario {
  const dir = join(root, 'fetch');
  mkdirSync(dir, { recursive: true });
  const truth = new Set<string>();
  for (let i = 0; i < scale; i++) {
    const real = `fetch/real-await-fetch-${i}.ts`;
    write(root, real, [
      `export async function realAwaitFetch${i}(url: string) {`,
      '  const response = await fetch(url);',
      '  return response.status;',
      '}',
      '',
    ]);
    truth.add(real);
    write(root, `fetch/plain-fetch-decoy-${i}.ts`, [
      `export function plainFetchDecoy${i}(url: string) {`,
      '  return fetch(url);',
      '}',
      '',
    ]);
    write(root, `fetch/comment-fetch-decoy-${i}.ts`, [
      `export async function commentFetchDecoy${i}(url: string) {`,
      '  // const response = await fetch(url);',
      '  return url;',
      '}',
      '',
    ]);
  }
  return {
    id: 'await_fetch',
    description: 'Find awaited fetch calls while ignoring un-awaited calls and comments.',
    rgPattern: 'fetch(',
    astPattern: 'await fetch($ARG)',
    astLang: 'typescript',
    truth,
  };
}

function write(root: string, relPath: string, content: string[]): void {
  const file = join(root, relPath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content.join('\n'));
}

function runRgScenario(fixture: SearchEvalFixture, scenario: SearchEvalScenario): SearchEvalMetrics {
  const started = performance.now();
  const proc = spawnSync('rg', ['-l', '--fixed-strings', scenario.rgPattern, fixture.root], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const elapsedMs = performance.now() - started;
  if (proc.error || (proc.status !== 0 && proc.status !== 1)) {
    const error = proc.error?.message ?? (proc.stderr.trim() || `rg exited ${proc.status}`);
    return emptyMetric('rg', scenario, elapsedMs, error);
  }
  return score('rg', scenario, elapsedMs, filesFromStdout(fixture.root, proc.stdout));
}

async function runAstGrepScenario(fixture: SearchEvalFixture, scenario: SearchEvalScenario): Promise<SearchEvalMetrics> {
  if (!hasAstGrep()) return emptyMetric('ast-grep', scenario, 0, 'ast-grep is not installed');
  const started = performance.now();
  try {
    const result = await dispatchAstGrep({
      pattern: scenario.astPattern,
      lang: scenario.astLang,
      path: fixture.root,
      output_mode: 'json',
      max_results: 1000,
    });
    const elapsedMs = performance.now() - started;
    const files = [...new Set(result.matches.map(match => normalizeRel(fixture.root, match.file)))];
    return score('ast-grep', scenario, elapsedMs, files);
  } catch (err) {
    return emptyMetric('ast-grep', scenario, performance.now() - started, err instanceof Error ? err.message : String(err));
  }
}

function filesFromStdout(root: string, stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(file => normalizeRel(root, file));
}

function normalizeRel(root: string, file: string): string {
  return relative(root, file).split('\\').join('/');
}

function score(
  engine: SearchEngineName,
  scenario: SearchEvalScenario,
  elapsedMs: number,
  matchedFiles: string[],
): SearchEvalMetrics {
  const matched = new Set(matchedFiles);
  const truePositives = [...matched].filter(file => scenario.truth.has(file)).length;
  const falsePositives = [...matched].filter(file => !scenario.truth.has(file)).length;
  const falseNegatives = [...scenario.truth].filter(file => !matched.has(file)).length;
  const precision = truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    engine,
    scenarioId: scenario.id,
    available: true,
    elapsedMs,
    matchedFiles: [...matched].sort(),
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

function emptyMetric(
  engine: SearchEngineName,
  scenario: SearchEvalScenario,
  elapsedMs: number,
  error: string,
): SearchEvalMetrics {
  return {
    engine,
    scenarioId: scenario.id,
    available: false,
    elapsedMs,
    matchedFiles: [],
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: scenario.truth.size,
    precision: 0,
    recall: 0,
    f1: 0,
    error,
  };
}

if (import.meta.main) {
  const complexityArg = process.argv.find(arg => arg.startsWith('--complexity='))?.split('=')[1] as SearchEvalComplexity | undefined;
  const keepFixture = process.argv.includes('--keep-fixture');
  const result = await runSearchEval({
    complexity: complexityArg && complexityArg in COMPLEXITY_SCALE ? complexityArg : 'medium',
    keepFixture,
  });
  console.log(renderSearchEvalMarkdown(result));
}
