// Archon-port T3 (2026-05-08) — `elanous workflow` CLI sub-commands.
//
// Backs the self-bootstrapping `samples/workflows/build-workflow.yaml`
// flow: an author types `elanous workflow run build-workflow "<idea>"`
// and the workflow does the rest (scan codebase → extract intent →
// generate YAML → validate → save).
//
// Sub-commands:
//   elanous workflow list                                 — discover all
//   elanous workflow show <name>                          — print YAML
//   elanous workflow validate <path|name>                 — schema check
//   elanous workflow run <name> [args...]                 — execute
//
// Run dispatch reuses the same default WorkflowDeps assembly the
// Nexus API uses (callLLM ↔ streamLLM, runBash ↔ child_process).
// MVP placeholders for runSkill / runCft / requestApproval surface
// helpful errors — see PLAN §4.1.

import { requirePosixShellCommand } from '../platform/default-shell.js';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  discoverWorkflows,
  findWorkflow,
  parseWorkflowYaml,
  runWorkflow,
  type WorkflowDeps,
  type ValidationWarning,
} from '../workflow-runtime/index.js';
import { buildRunCft, buildRunSkill } from '../workflow-runtime/deps-bridge.js';
import * as ui from '../ui.js';

interface RunOpts {
  signal?: AbortSignal;
}

/** Build the same WorkflowDeps the Nexus API uses. Kept as a CLI-local
 *  copy (rather than imported from src/nexus/api/workflows.ts) to avoid
 *  pulling the HTTP server graph into a CLI invocation that doesn't
 *  need it. */
export function buildCliWorkflowDeps(): WorkflowDeps {
  return {
    callLLM: async ({ prompt, model, provider: providerName, signal, onPartialChunk }) => {
      const llm = require('../llm.js') as typeof import('../llm.js');
      // Provider resolution (HANDOFF §4.4 wire-through · 2026-05-08):
      // YAML's `provider: claude|openai|grok|gemini|local` field is
      // surfaced via ctx.resolvedProvider in workflow-runtime/executor
      // and propagated to callLLM by prompt.ts. Look up the provider
      // by id; fall back to model-derived default when the name is
      // unknown so a typo can't crash the run.
      let provider = providerName ? llm.PROVIDERS[providerName] : undefined;
      if (!provider) provider = llm.resolveDefaultProvider(model);
      // Model compatibility (#1973 dogfood follow-up): if the hint's
      // family doesn't match the resolved provider, drop it and let
      // the provider use its own default.
      const safeModel = llm.isModelCompatible(provider.name, model) ? model : undefined;
      const opts: Parameters<typeof llm.streamLLM>[2] = {
        ...(safeModel !== undefined ? { model: safeModel } : {}),
        ...(signal !== undefined ? { signal } : {}),
        provider,
      };
      // V2.2-1 (2026-05-12) — CLI path forwards partial chunks when a
      // streaming consumer attaches (rare for `elanous workflow run` but
      // kept for parity with the NEXUS deps wire so a future CLI flag
      // like `--stream` can opt in without touching the runtime).
      return llm.streamLLM(
        [{ role: 'user', content: prompt }],
        onPartialChunk ? (delta: string) => onPartialChunk(delta) : () => {},
        opts,
      );
    },
    runBash: (body, runOpts) => new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(requirePosixShellCommand('bash'), ['-c', body], {
        cwd: runOpts.cwd ?? process.cwd(),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (runOpts.timeoutMs) {
        timer = setTimeout(() => { child.kill('SIGTERM'); }, runOpts.timeoutMs);
      }
      if (runOpts.signal) {
        runOpts.signal.addEventListener('abort', () => { child.kill('SIGTERM'); });
      }
      child.stdout.on('data', d => { stdout += String(d); });
      child.stderr.on('data', d => { stderr += String(d); });
      child.on('close', code => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
      child.on('error', err => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    }),
    runSkill: buildRunSkill(),
    runCft: buildRunCft(),
    requestApproval: async (message: string) => {
      // CLI: best-effort interactive prompt via stdin. Replies anything
      // non-empty → captured response. Empty line → 'approved'.
      process.stdout.write(`\n[approval] ${message}\n  > `);
      const line = await readLine();
      const trimmed = line.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
  };
}

function readLine(): Promise<string> {
  return new Promise(res => {
    process.stdin.setEncoding('utf-8');
    const onData = (chunk: string): void => {
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      res(chunk.replace(/\n$/, ''));
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

// ── Sub-command implementations ────────────────────────────────────

export function workflowList(): void {
  const list = discoverWorkflows();
  if (list.length === 0) {
    console.log('No workflows discovered.');
    console.log('  Project: <cwd>/.elanous/workflows/*.yaml');
    console.log('  Global:  ~/.elanous/workflows/*.yaml');
    console.log('  Builtin: samples/workflows/*.yaml');
    return;
  }
  ui.header(`Workflows (${list.length})`);
  console.log('');
  const buckets = { project: [] as typeof list, global: [] as typeof list, builtin: [] as typeof list };
  for (const e of list) buckets[e.source.source].push(e);
  for (const scope of ['project', 'global', 'builtin'] as const) {
    if (buckets[scope].length === 0) continue;
    console.log(`  [${scope}]`);
    for (const e of buckets[scope]) {
      const desc = e.definition.description.split('\n')[0]?.slice(0, 60) ?? '';
      console.log(`    ${e.definition.name.padEnd(28)} ${e.definition.nodes.length} nodes  ${desc}`);
    }
    console.log('');
  }
}

export function workflowShow(name: string): number {
  const entry = findWorkflow(name);
  if (!entry) {
    ui.error(`workflow not found: ${name}`);
    return 1;
  }
  console.log(`# source: ${entry.source.source}`);
  console.log(`# path:   ${entry.source.path}`);
  console.log('');
  console.log(readFileSync(entry.source.path, 'utf-8'));
  return 0;
}

/** Scheduler-retirement R3 (2026-05-11) — `elanous wf synth <intent>`.
 *
 *  Calls the workflow-synth orchestrator with a real LLM. The intent
 *  + optional `--preview` / `--save-project` flags map to the
 *  WorkflowSynthOpts. Default scope is 'global' (saves under
 *  `~/.elanous/workflows/`). */
export async function workflowSynth(
  intent: string,
  opts: { preview?: boolean; saveProject?: boolean } = {},
): Promise<number> {
  const { synthWorkflowFromIntent } = await import('../workflow-synth/index.js');
  const deps = buildCliWorkflowDeps();
  const synthOpts: Parameters<typeof synthWorkflowFromIntent>[0] = {
    intent,
    preview: opts.preview ?? false,
    scope: opts.saveProject ? 'project' : 'global',
  };
  const r = await synthWorkflowFromIntent(synthOpts, deps);
  if (!r.ok) {
    ui.error(`synth failed: ${r.error ?? '(no error)'}`);
    if (r.yaml) {
      console.log('');
      console.log('Last LLM output:');
      console.log(r.yaml);
    }
    return 1;
  }
  ui.header(`Workflow synthesized: ${r.workflowName ?? '(unnamed)'}`);
  console.log(`  trigger: ${r.triggerSummary ?? 'manual'}`);
  if (r.repaired) console.log('  (LLM self-repaired after one validation failure)');
  console.log('');
  console.log(r.yaml);
  console.log('');
  if (r.registered && r.registeredPath) {
    ui.info(`Registered at ${r.registeredPath}`);
  } else if (opts.preview) {
    ui.info('Preview mode — not registered. Re-run without --preview to save.');
  }
  return 0;
}

export function workflowValidate(target: string): number {
  // Accept either a name or a path.
  let yamlText: string;
  let label: string;
  if (target.includes('/') || target.endsWith('.yaml') || target.endsWith('.yml')) {
    const path = resolve(process.cwd(), target);
    if (!existsSync(path)) {
      ui.error(`file not found: ${path}`);
      return 1;
    }
    yamlText = readFileSync(path, 'utf-8');
    label = path;
  } else {
    const entry = findWorkflow(target);
    if (!entry) {
      ui.error(`workflow not found: ${target}`);
      return 1;
    }
    yamlText = readFileSync(entry.source.path, 'utf-8');
    label = entry.source.path;
  }
  const r = parseWorkflowYaml(yamlText);
  if (r.ok) {
    console.log(`✓ ${label}`);
    console.log(`  ${r.workflow!.nodes.length} nodes`);
    // M4-2 (2026-05-12) — surface deterministic advisory warnings from
    // `validation-warnings.ts` (7 rule kinds). schema-valid 가 곧
    // 의도-valid 는 아니라서 cost / lint / 보안 hint 를 CLI 에 노출.
    // Author CLI (R3 NL synth retry 가 hint 로 흡수) + dogfood
    // surfaces 양쪽에서 같은 텍스트 사용.
    printWarnings(r.warnings);
    return 0;
  }
  ui.error(`invalid workflow: ${label}`);
  for (const issue of r.issues) {
    console.log(`  · ${issue.path || '(root)'}: ${issue.message}`);
  }
  return 1;
}

function printWarnings(warnings: readonly ValidationWarning[]): void {
  if (warnings.length === 0) return;
  console.log('');
  console.log(`  ⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''}:`);
  for (const w of warnings) {
    const tag = `[${w.severity}]`.padEnd(8);
    const where = w.path ? `  (${w.path})` : (w.nodeId ? `  (${w.nodeId})` : '');
    console.log(`  ${tag} ${w.code}: ${w.message}${where}`);
    if (w.suggestion) console.log(`           ↳ ${w.suggestion}`);
  }
}

export async function workflowRun(
  name: string,
  args: string,
  opts: RunOpts = {},
): Promise<number> {
  const entry = findWorkflow(name);
  if (!entry) {
    ui.error(`workflow not found: ${name}`);
    return 1;
  }
  ui.header(`Running ${name}`);
  console.log(`  source: ${entry.source.source}`);
  console.log(`  args:   ${args || '(none)'}`);
  console.log('');
  const deps = buildCliWorkflowDeps();
  const runId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let exitCode = 0;
  for await (const evt of runWorkflow(
    {
      workflow: entry.definition,
      arguments: args,
      runId,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    },
    deps,
  )) {
    if (evt.type === 'workflow_start') {
      console.log(`  [start] runId=${evt.runId}`);
    } else if (evt.type === 'node_start') {
      process.stdout.write(`  [${evt.nodeType}] ${evt.nodeId} ...`);
    } else if (evt.type === 'node_skipped') {
      console.log(` skipped (${evt.reason})`);
    } else if (evt.type === 'node_done') {
      const tag = evt.result.ok ? 'ok' : 'fail';
      const ms = evt.result.durationMs;
      console.log(` ${tag} (${ms}ms)`);
      if (!evt.result.ok && evt.result.error) {
        console.log(`      error: ${evt.result.error}`);
      }
    } else if (evt.type === 'workflow_done') {
      console.log('');
      console.log(`✓ workflow_done · ${Object.keys(evt.outputs).length} outputs`);
    } else if (evt.type === 'workflow_failed') {
      console.log('');
      ui.error(`workflow_failed: ${evt.error}`);
      exitCode = 1;
    }
  }
  return exitCode;
}
