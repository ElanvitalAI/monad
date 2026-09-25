// F-B2 — `/playground` slash command factory.
//
// Registers a single command that enumerates the scenario
// registry + dispatches a chosen scenario against a
// `PlaygroundHarness`. Output lines are handed to an injected
// writer so tests + production wire their own log sinks.
//
// Usage:
//   /playground                → list all registered scenarios
//   /playground list           → same as above
//   /playground run <id>       → execute scenario by id
//   /playground run <id> -v    → verbose (per-step report)
//   /playground parse <path>   → parse a YAML scenario file (F-B4),
//                                reports errors + warnings as
//                                `line:col — message` for editor use
//   /playground edit <id>      → dump an existing scenario as YAML
//                                (F-B5a). Feeds `/playground save`
//                                once the UI editor (F-B5b) lands.
//   /playground save <id> <path>
//                              → parse a YAML file and register the
//                                scenario under `<id>` in the active
//                                registry (memory only — disk save
//                                deferred to F-B5.1).
//
// The command is deliberately self-contained — no dashboard
// coupling. `dashboard-playground-integration.ts` (F-B2) wires
// it into the shared `CommandRegistry` at startup.

import { runScenario } from './runner.js';
import type { ScenarioRegistry } from './registry.js';
import type { PlaygroundHarness, Scenario, StepResult } from './types.js';
import { parseScenarioYaml, type ParseError, type ParseWarning } from './yaml-parser.js';
import { serializeScenarioToYaml } from './yaml-serializer.js';

export interface PlaygroundCommandDeps {
  registry: ScenarioRegistry;
  /** Provides a fresh `PlaygroundHarness` per `run` invocation.
   *  The harness is disposed (if it has `.disposeAll`) after the
   *  scenario completes, so state doesn't leak across runs. */
  makeHarness: () => PlaygroundHarness & { disposeAll?: () => void };
  /** Line-level output sink. Multiple calls = multiple lines. */
  write: (line: string) => void;
  /** Injected file reader for `/playground parse <path>`. Defaults
   *  to a real `readFile` at wire-in time; tests pass a stub. */
  readFile?: (path: string) => Promise<string>;
  /** Optional UI hook: when provided, `/playground edit <id>` opens the
   *  scenario in a live lab/editor surface instead of dumping YAML to
   *  the output sink. */
  onEditScenario?: (scenario: Scenario) => void | Promise<void>;
}

/** Dispatcher used by `CommandRegistry.register({ handler: ... })`.
 *  `args` is the positional arg list (already tokenised by the
 *  host). */
export function createPlaygroundCommandHandler(
  deps: PlaygroundCommandDeps,
): (args: string[]) => Promise<void> {
  return async (args: string[]): Promise<void> => {
    const sub = args[0] ?? 'list';
    if (sub === 'list' || sub === undefined) {
      listScenarios(deps);
      return;
    }
    if (sub === 'run') {
      await runCommand(args.slice(1), deps);
      return;
    }
    if (sub === 'parse') {
      await parseCommand(args.slice(1), deps);
      return;
    }
    if (sub === 'edit') {
      editCommand(args.slice(1), deps);
      return;
    }
    if (sub === 'save') {
      await saveCommand(args.slice(1), deps);
      return;
    }
    deps.write(`unknown subcommand '${sub}'. Use: /playground [list | run <id> [-v] | parse <path> | edit <id> | save <id> <path>]`);
  };
}

function editCommand(args: string[], deps: PlaygroundCommandDeps): void {
  const id = args[0];
  if (!id) {
    deps.write('/playground edit: missing scenario id. Use: /playground edit <id>');
    return;
  }
  const scenario = deps.registry.get(id);
  if (!scenario) {
    deps.write(`/playground edit: no scenario '${id}'. Try /playground list.`);
    return;
  }
  if (deps.onEditScenario) {
    void Promise.resolve(deps.onEditScenario(scenario))
      .then(() => deps.write(`/playground edit: opened '${scenario.id}' in the playground lab`))
      .catch((err) => {
        deps.write(`/playground edit: failed to open '${scenario.id}': ${(err as Error).message}`);
      });
    return;
  }
  const yaml = serializeScenarioToYaml(scenario);
  deps.write(`# ${scenario.id} — ${scenario.title}`);
  for (const line of yaml.split('\n')) deps.write(line);
}

async function saveCommand(args: string[], deps: PlaygroundCommandDeps): Promise<void> {
  const id = args[0];
  const path = args[1];
  if (!id || !path) {
    deps.write('/playground save: missing args. Use: /playground save <id> <path>');
    return;
  }
  const reader = deps.readFile ?? defaultReadFile;
  let source: string;
  try {
    source = await reader(path);
  } catch (e) {
    deps.write(`/playground save: cannot read '${path}': ${(e as Error).message}`);
    return;
  }
  const result = parseScenarioYaml(source);
  if (result.errors.length > 0) {
    deps.write(`/playground save: refusing to register — ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      deps.write(`  ✗ ${err.line}:${err.col} [${err.severity}] ${err.path ? err.path + ' — ' : ''}${err.message}`);
    }
    return;
  }
  if (!result.scenario?.id || !result.scenario?.title) {
    deps.write('/playground save: scenario requires id + title');
    return;
  }

  const scenario: Scenario = {
    id,  // override id from arg
    title: result.scenario.title,
    description: result.scenario.description,
    tags: result.scenario.tags,
    setup: result.scenario.setup,
    steps: (result.scenario.steps ?? []) as Scenario['steps'],
  };
  deps.registry.register(scenario);
  deps.write(`/playground save: registered '${id}' (${scenario.steps.length} step${scenario.steps.length === 1 ? '' : 's'})`);
  if (result.warnings.length > 0) {
    deps.write(`  ${result.warnings.length} warning(s) — run /playground parse ${path} for detail`);
  }
}

async function parseCommand(args: string[], deps: PlaygroundCommandDeps): Promise<void> {
  const path = args[0];
  if (!path) {
    deps.write('/playground parse: missing file path. Use: /playground parse <path>');
    return;
  }
  const reader = deps.readFile ?? defaultReadFile;
  let source: string;
  try {
    source = await reader(path);
  } catch (e) {
    deps.write(`/playground parse: cannot read '${path}': ${(e as Error).message}`);
    return;
  }

  const result = parseScenarioYaml(source);
  const id = result.scenario?.id ?? '(no id)';
  const title = result.scenario?.title ?? '';
  const stepCount = result.validSteps.length;
  deps.write(`parsed '${path}' — ${id}${title ? ` · ${title}` : ''} · ${stepCount} valid step${stepCount === 1 ? '' : 's'}`);
  deps.write(`  errors=${result.errors.length}  warnings=${result.warnings.length}`);

  for (const err of result.errors) {
    deps.write(`  ✗ ${formatLoc(err)} [${err.severity}] ${err.path ? err.path + ' — ' : ''}${err.message}`);
  }
  for (const w of result.warnings) {
    deps.write(`  ⚠ ${formatLoc(w)} ${w.path ? w.path + ' — ' : ''}${w.message}`);
  }
}

function formatLoc(e: ParseError | ParseWarning): string {
  return `${e.line}:${e.col}`;
}

async function defaultReadFile(path: string): Promise<string> {
  const fs = await import('node:fs/promises');
  return fs.readFile(path, 'utf8');
}

function listScenarios(deps: PlaygroundCommandDeps): void {
  const all = deps.registry.list();
  if (all.length === 0) {
    deps.write('/playground: no scenarios registered');
    return;
  }
  deps.write(`/playground: ${all.length} scenario${all.length === 1 ? '' : 's'}`);
  for (const s of all) {
    const tagStr = (s.tags && s.tags.length > 0) ? ` [${s.tags.join(',')}]` : '';
    deps.write(`  ${s.id}${tagStr}  —  ${s.title}`);
  }
}

async function runCommand(
  args: string[],
  deps: PlaygroundCommandDeps,
): Promise<void> {
  const id = args[0];
  const verbose = args.includes('-v') || args.includes('--verbose');
  if (!id) {
    deps.write('/playground run: missing scenario id. Use: /playground run <id> [-v]');
    return;
  }
  const scenario = deps.registry.get(id);
  if (!scenario) {
    deps.write(`/playground run: no scenario '${id}'. Try /playground list.`);
    return;
  }

  const harness = deps.makeHarness();
  let result;
  try {
    result = await runScenario(scenario, harness);
  } finally {
    if (typeof harness.disposeAll === 'function') {
      try { harness.disposeAll(); } catch { /* isolate */ }
    }
  }

  const icon =
    result.status === 'pass'  ? '✓' :
    result.status === 'fail'  ? '✗' :
                                '!';
  deps.write(`${icon} ${scenario.id} — ${result.status.toUpperCase()} in ${result.durationMs}ms`);
  if (verbose || result.status !== 'pass') {
    for (let i = 0; i < result.stepResults.length; i++) {
      const r = result.stepResults[i]!;
      const prefix =
        r.status === 'pass'    ? '    pass' :
        r.status === 'fail'    ? '    FAIL' :
        r.status === 'error'   ? '   ERROR' :
                                 ' skipped';
      const details = formatStepDetail(r);
      deps.write(`  ${prefix} · step ${i + 1} · ${r.step.action}${details}`);
    }
  }
}

function formatStepDetail(r: StepResult): string {
  if (r.status === 'pass' || r.status === 'skipped') return '';
  const parts: string[] = [];
  if (r.message) parts.push(` — ${r.message}`);
  if (r.actual !== undefined) {
    const actualStr = typeof r.actual === 'string'
      ? r.actual
      : safeStringify(r.actual);
    parts.push(` (actual=${actualStr})`);
  }
  return parts.join('');
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 80 ? s.slice(0, 77) + '…' : (s ?? String(v));
  } catch {
    return String(v);
  }
}
