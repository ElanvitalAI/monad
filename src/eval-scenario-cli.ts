// ── elanous repro --scenario — multi-prompt batch evaluator ────────────────
//
// Sister of eval-prompt-cli.ts. Reads a YAML scenario file with N prompts
// + per-prompt assertions, executes them in parallel (concurrency-capped)
// or sequentially, and prints a table of results. Promptfoo-inspired
// schema: each prompt is a self-contained run with its own asserts, and a
// single `defaults:` block sets shared model / cwd / maxTurns / asserts
// so the YAML stays terse for the common case.
//
// Usage:
//   bun run src/index.ts repro --scenario tests/scenarios/codex-baseline.yaml
//   bun run src/index.ts repro --scenario tests/scenarios/codex-baseline.yaml --json
//
// Exit code:
//   0  — every prompt passed (text non-empty AND all asserts ✓)
//   1  — at least one prompt failed
//   2  — system error (file missing, YAML parse error, etc.)
//
// Schema (YAML):
//   description: free-form
//   defaults:
//     model: gpt-5.4         # optional, default 'gpt-5.4'
//     cwd: .                 # optional, default process.cwd()
//     max_turns: 8           # optional
//     asserts:               # optional, merged into each prompt's asserts
//       tool_max: {Glob: 5}
//   prompts:
//     - id: analysis
//       prompt: "..."
//       model: gpt-5.4       # overrides defaults.model
//       asserts:
//         text_contains: ["..."]
//         text_min_chars: 200
//         tool_min: {Read: 1}
//         tool_max: {Glob: 5}
//         no_event: ["tool-loop.dedup-blocked"]
//         must_event: ["tool-loop.anchor-grep-blocked"]

import { parse as parseYaml } from 'yaml';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import {
  type EvalPromptOpts,
  type EvalPromptResult,
  runEvalPrompt,
} from './eval-prompt-cli.js';

export interface ScenarioPromptAsserts {
  text_contains?: string[];
  text_min_chars?: number;
  tool_min?: Record<string, number>;
  tool_max?: Record<string, number>;
  no_event?: string[];
  must_event?: string[];
}

export interface ScenarioPrompt {
  id: string;
  prompt: string;
  model?: string;
  cwd?: string;
  max_turns?: number;
  asserts?: ScenarioPromptAsserts;
  /** Look up a rotation entry (label / provider / model substring) and
   *  use its provider + apiKey + model for this prompt. Mirrors the
   *  `--rotate` CLI flag. Overrides per-prompt model. Lets a single
   *  scenario fan-out across all configured providers — e.g. four
   *  prompts with same `prompt:` but different `rotate:` values for
   *  side-by-side comparison. */
  rotate?: string;
}

export interface ScenarioDefaults {
  model?: string;
  cwd?: string;
  max_turns?: number;
  asserts?: ScenarioPromptAsserts;
  rotate?: string;
}

export interface ScenarioFile {
  description?: string;
  defaults?: ScenarioDefaults;
  prompts: ScenarioPrompt[];
}

export interface ScenarioPromptResult {
  id: string;
  ok: boolean;
  text_chars: number;
  text_min_chars_threshold?: number;
  result: EvalPromptResult;
  custom_failures: string[];
}

export interface ScenarioRunResult {
  scenario_path: string;
  description?: string;
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  results: ScenarioPromptResult[];
}

/** Strict-ish schema validation. Throws on missing fields / wrong types. */
function validateScenario(raw: unknown, sourcePath: string): ScenarioFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${sourcePath}: scenario root must be a YAML object`);
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.prompts)) {
    throw new Error(`${sourcePath}: missing required 'prompts' array`);
  }
  const prompts: ScenarioPrompt[] = [];
  for (let i = 0; i < obj.prompts.length; i++) {
    const p = obj.prompts[i];
    if (typeof p !== 'object' || p === null) {
      throw new Error(`${sourcePath}: prompts[${i}] must be an object`);
    }
    const pObj = p as Record<string, unknown>;
    if (typeof pObj.id !== 'string' || pObj.id.length === 0) {
      throw new Error(`${sourcePath}: prompts[${i}].id must be a non-empty string`);
    }
    if (typeof pObj.prompt !== 'string' || pObj.prompt.length === 0) {
      throw new Error(`${sourcePath}: prompts[${i}].prompt must be a non-empty string`);
    }
    prompts.push({
      id: pObj.id,
      prompt: pObj.prompt,
      ...(typeof pObj.model === 'string' ? { model: pObj.model } : {}),
      ...(typeof pObj.cwd === 'string' ? { cwd: pObj.cwd } : {}),
      ...(typeof pObj.max_turns === 'number' ? { max_turns: pObj.max_turns } : {}),
      ...(typeof pObj.rotate === 'string' ? { rotate: pObj.rotate } : {}),
      ...(typeof pObj.asserts === 'object' && pObj.asserts !== null
        ? { asserts: pObj.asserts as ScenarioPromptAsserts }
        : {}),
    });
  }
  return {
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    ...(typeof obj.defaults === 'object' && obj.defaults !== null
      ? { defaults: obj.defaults as ScenarioDefaults }
      : {}),
    prompts,
  };
}

/** Merge defaults into a prompt's effective options. Asserts merge by
 *  shallow concat (lists) / merge (records). */
function mergeOpts(
  defaults: ScenarioDefaults | undefined,
  prompt: ScenarioPrompt,
  scenarioCwd: string,
): EvalPromptOpts {
  const cwd = prompt.cwd ?? defaults?.cwd ?? scenarioCwd;
  const max_turns = prompt.max_turns ?? defaults?.max_turns;
  const asserts = mergeAsserts(defaults?.asserts, prompt.asserts);
  const rotate = prompt.rotate ?? defaults?.rotate;
  // When `rotate:` is set, the rotation entry's model wins — leave
  // model undefined so runEvalPrompt picks it up from the entry.
  // Otherwise apply the prompt-level / defaults-level / final fallback.
  const model = rotate !== undefined
    ? prompt.model
    : (prompt.model ?? defaults?.model ?? 'gpt-5.5');
  const opts: EvalPromptOpts = {
    prompt: prompt.prompt,
    cwd: resolvePath(scenarioCwd, cwd),
    silent: true,
    json: false,
    ...(model !== undefined ? { model } : {}),
    ...(rotate !== undefined ? { rotate } : {}),
    ...(max_turns !== undefined ? { maxTurns: max_turns } : {}),
    ...(asserts.text_contains !== undefined ? { assertTextContains: asserts.text_contains } : {}),
    ...(asserts.tool_min !== undefined ? { assertToolMin: asserts.tool_min } : {}),
    ...(asserts.tool_max !== undefined ? { assertToolMax: asserts.tool_max } : {}),
    ...(asserts.no_event !== undefined ? { assertNoEvent: asserts.no_event } : {}),
    ...(asserts.must_event !== undefined ? { assertEvent: asserts.must_event } : {}),
  };
  return opts;
}

function mergeAsserts(
  d: ScenarioPromptAsserts | undefined,
  p: ScenarioPromptAsserts | undefined,
): ScenarioPromptAsserts {
  if (!d && !p) return {};
  return {
    ...(d?.text_contains || p?.text_contains
      ? { text_contains: [...(d?.text_contains ?? []), ...(p?.text_contains ?? [])] }
      : {}),
    ...(p?.text_min_chars !== undefined
      ? { text_min_chars: p.text_min_chars }
      : d?.text_min_chars !== undefined
        ? { text_min_chars: d.text_min_chars }
        : {}),
    ...(d?.tool_min || p?.tool_min
      ? { tool_min: { ...(d?.tool_min ?? {}), ...(p?.tool_min ?? {}) } }
      : {}),
    ...(d?.tool_max || p?.tool_max
      ? { tool_max: { ...(d?.tool_max ?? {}), ...(p?.tool_max ?? {}) } }
      : {}),
    ...(d?.no_event || p?.no_event
      ? { no_event: [...(d?.no_event ?? []), ...(p?.no_event ?? [])] }
      : {}),
    ...(d?.must_event || p?.must_event
      ? { must_event: [...(d?.must_event ?? []), ...(p?.must_event ?? [])] }
      : {}),
  };
}

/** Run the scenario file and return aggregated results. Default
 *  concurrency = 4 — multi-provider matrices (codex+opus+grok+gemini)
 *  saturate at independent provider rate limits without contention.
 *  Pass `concurrency: 1` for sequential (legacy) behavior — useful for
 *  single-provider scenarios that share rate-limit budget. */
export async function runScenarioFile(
  scenarioPath: string,
  opts: { silent?: boolean; json?: boolean; concurrency?: number; tools?: EvalPromptOpts['tools'] } = {},
): Promise<ScenarioRunResult> {
  const startedAt = Date.now();
  const abs = resolvePath(scenarioPath);
  if (!existsSync(abs)) {
    throw new Error(`scenario file not found: ${abs}`);
  }
  const raw = readFileSync(abs, 'utf8');
  const parsed = parseYaml(raw);
  const scenario = validateScenario(parsed, abs);
  const scenarioCwd = dirname(abs);
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));
  const effectiveConcurrency = Math.min(concurrency, scenario.prompts.length);
  if (!opts.silent && !opts.json) {
    process.stdout.write(`[scenario] ${abs}\n`);
    if (scenario.description) {
      process.stdout.write(`[scenario] ${scenario.description}\n`);
    }
    const mode = effectiveConcurrency === 1 ? 'sequential' : `parallel ×${effectiveConcurrency}`;
    process.stdout.write(`[scenario] ${scenario.prompts.length} prompt(s) — ${mode}\n\n`);
  }

  // Worker-pool: results indexed by prompt position so the final summary
  // preserves YAML order regardless of completion order. Per-prompt
  // start/end log lines stream out of order and rely on the [id] tag for
  // identification — no row-locking needed since stdout writes are atomic
  // at line granularity for short writes.
  const results: ScenarioPromptResult[] = new Array(scenario.prompts.length);
  let nextIdx = 0;
  const runOne = async (idx: number): Promise<void> => {
    const prompt = scenario.prompts[idx]!;
    const promptOpts = mergeOpts(scenario.defaults, prompt, scenarioCwd);
    if (opts.tools !== undefined) promptOpts.tools = opts.tools;
    if (!opts.silent && !opts.json) {
      const modelLabel = promptOpts.rotate !== undefined
        ? `rotate=${promptOpts.rotate}`
        : `model=${promptOpts.model ?? 'default'}`;
      process.stdout.write(`[scenario] [${prompt.id}] running... (${modelLabel})\n`);
    }
    const promptStart = Date.now();
    const result = await runEvalPrompt(promptOpts);
    const promptDur = Date.now() - promptStart;
    const customFailures: string[] = [];
    const text_min_chars = mergeAsserts(scenario.defaults?.asserts, prompt.asserts).text_min_chars;
    if (text_min_chars !== undefined && result.text.length < text_min_chars) {
      customFailures.push(
        `text_min_chars: got ${result.text.length} chars, expected ≥ ${text_min_chars}`,
      );
    }
    const ok = result.assertions.length === 0 && customFailures.length === 0 && result.text.length > 0;
    results[idx] = {
      id: prompt.id,
      ok,
      text_chars: result.text.length,
      ...(text_min_chars !== undefined ? { text_min_chars_threshold: text_min_chars } : {}),
      result,
      custom_failures: customFailures,
    };
    if (!opts.silent && !opts.json) {
      const status = ok ? '✓' : '✗';
      process.stdout.write(
        `[scenario] [${prompt.id}] ${status}  ${promptDur}ms  ` +
        `${result.toolCallCount} calls, ${result.text.length} chars\n`,
      );
      if (!ok) {
        for (const f of result.assertions) {
          process.stdout.write(`  ✗ [${prompt.id}] [${f.rule}] ${f.message}\n`);
        }
        for (const cf of customFailures) {
          process.stdout.write(`  ✗ [${prompt.id}] ${cf}\n`);
        }
        if (result.text.length === 0) {
          process.stdout.write(`  ✗ [${prompt.id}] final text was empty\n`);
        }
      }
    }
  };
  const pump = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= scenario.prompts.length) return;
      await runOne(idx);
    }
  };
  await Promise.all(Array.from({ length: effectiveConcurrency }, pump));
  const duration_ms = Date.now() - startedAt;
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  const summary: ScenarioRunResult = {
    scenario_path: abs,
    ...(scenario.description !== undefined ? { description: scenario.description } : {}),
    total: results.length,
    passed,
    failed,
    duration_ms,
    results,
  };
  if (opts.json) {
    process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  } else if (!opts.silent) {
    process.stdout.write(`\n[scenario] ${passed}/${results.length} PASS in ${duration_ms}ms\n`);
    if (failed > 0) {
      process.stdout.write(`[scenario] ${failed} FAILED — see per-prompt output above\n`);
    }
  }
  return summary;
}

/** Argv-driven entry. Wired by `program.command('repro --scenario ...')`. */
export async function runScenarioCommand(args: {
  scenarioPath: string;
  json?: boolean;
  silent?: boolean;
  concurrency?: number;
  tools?: EvalPromptOpts['tools'];
}): Promise<void> {
  try {
    const fileOpts: Parameters<typeof runScenarioFile>[1] = {
      json: args.json,
      silent: args.silent,
      tools: args.tools,
    };
    if (args.concurrency !== undefined) fileOpts.concurrency = args.concurrency;
    const result = await runScenarioFile(args.scenarioPath, fileOpts);
    process.exit(result.failed === 0 ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[scenario] error: ${msg}\n`);
    process.exit(2);
  }
}
