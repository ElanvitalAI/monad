// Scheduler-retirement R3 (2026-05-11) — workflow synth from intent.
//
// Pure-ish orchestrator: takes a natural-language `intent`, calls the
// injected LLM with the system prompt, validates the YAML output,
// optionally retries once on validation failure (self-repair), and
// (when `preview=false`) saves the result to `~/.monad/workflows/`.
//
// The LLM is injected so tests can use a deterministic stub.
//
// Companion: `src/workflow-synth/system-prompt.ts` (system prompt) ·
// `src/cli/workflow-synth.ts` (CLI command).

import { parseWorkflowYaml } from '../workflow-runtime/parser.js';
import { saveWorkflow } from '../workflow-runtime/storage.js';
import { WORKFLOW_SYNTH_SYSTEM_PROMPT } from './system-prompt.js';
import type { WorkflowDeps } from '../workflow-runtime/types.js';

export interface WorkflowSynthOpts {
  intent: string;
  /** Extra context — current time, user identity, recent runs, etc.
   *  Appended verbatim after the intent so the LLM has fresh signals. */
  context?: string;
  /** When true, returns the YAML without saving. Default false. */
  preview?: boolean;
  /** Save scope when `preview=false`. Default 'global'. */
  scope?: 'project' | 'global';
  /** Override cwd (used when scope='project'). */
  cwd?: string;
  /** Optional abort signal forwarded to the LLM call. */
  signal?: AbortSignal;
}

export interface WorkflowSynthResult {
  ok: boolean;
  /** Generated YAML body (always present on ok=true). */
  yaml?: string;
  /** Workflow slug parsed from the YAML's `name:` field. */
  workflowName?: string;
  /** Human-readable trigger description for the preview UI. */
  triggerSummary?: string;
  /** Set when the workflow was actually persisted. */
  registered: boolean;
  registeredPath?: string;
  /** When ok=false: validation error or LLM-call failure. */
  error?: string;
  /** When the LLM took two passes (self-repair). */
  repaired?: boolean;
}

const MAX_REPAIRS = 1;

/** Synthesize a workflow YAML from a natural-language intent. */
export async function synthWorkflowFromIntent(
  opts: WorkflowSynthOpts,
  deps: Pick<WorkflowDeps, 'callLLM'>,
): Promise<WorkflowSynthResult> {
  const preview = opts.preview ?? false;
  const scope: 'project' | 'global' = opts.scope ?? 'global';
  const baseSignalArg = opts.signal ? { signal: opts.signal } : {};

  let attempt = 0;
  let yaml = '';
  let lastError = '';
  let repaired = false;

  while (attempt <= MAX_REPAIRS) {
    const userPrompt = attempt === 0
      ? buildInitialPrompt(opts)
      : buildRepairPrompt(opts, yaml, lastError);
    let response: string;
    try {
      response = await deps.callLLM({
        prompt: userPrompt,
        systemPrompt: WORKFLOW_SYNTH_SYSTEM_PROMPT,
        ...baseSignalArg,
      });
    } catch (err) {
      return {
        ok: false,
        registered: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    yaml = stripCodeFences(response);
    const validation = parseWorkflowYaml(yaml);
    if (validation.ok && validation.workflow) {
      const workflow = validation.workflow;
      const triggerSummary = describeTrigger(
        (workflow.nodes ?? []) as unknown as Array<Record<string, unknown>>,
      );
      if (preview) {
        return {
          ok: true,
          yaml,
          workflowName: workflow.name,
          triggerSummary,
          registered: false,
          ...(repaired ? { repaired: true } : {}),
        };
      }
      const saveOpts: { scope: 'project' | 'global'; cwd?: string } = { scope };
      if (opts.cwd !== undefined) saveOpts.cwd = opts.cwd;
      const saved = saveWorkflow(workflow.name, yaml, saveOpts);
      if (!saved.ok) {
        return {
          ok: false,
          yaml,
          workflowName: workflow.name,
          triggerSummary,
          registered: false,
          error: saved.error
            ?? (saved.validation?.issues?.[0]?.message ?? 'save failed'),
          ...(repaired ? { repaired: true } : {}),
        };
      }
      return {
        ok: true,
        yaml,
        workflowName: workflow.name,
        triggerSummary,
        registered: true,
        ...(saved.path !== undefined ? { registeredPath: saved.path } : {}),
        ...(repaired ? { repaired: true } : {}),
      };
    }

    lastError = validation.issues
      .map(e => `${e.path}: ${e.message}`)
      .join('; ') || 'workflow failed schema validation';
    attempt += 1;
    if (attempt <= MAX_REPAIRS) repaired = true;
  }

  return {
    ok: false,
    yaml,
    registered: false,
    error: `validation failed after ${MAX_REPAIRS + 1} attempts: ${lastError}`,
    repaired,
  };
}

function buildInitialPrompt(opts: WorkflowSynthOpts): string {
  const parts = [`intent: ${opts.intent}`];
  if (opts.context) parts.push(`context: ${opts.context}`);
  return parts.join('\n');
}

function buildRepairPrompt(
  opts: WorkflowSynthOpts,
  prevYaml: string,
  validationError: string,
): string {
  return [
    `intent: ${opts.intent}`,
    opts.context ? `context: ${opts.context}` : '',
    '',
    'Your previous attempt failed validation. Fix the errors below.',
    '',
    `validation_errors: ${validationError}`,
    '',
    'previous_yaml:',
    prevYaml,
  ].filter(Boolean).join('\n');
}

function stripCodeFences(s: string): string {
  // Tolerate LLMs that emit ```yaml ... ``` despite the instructions.
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  const lines = t.split('\n');
  lines.shift(); // drop opening fence
  if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
    lines.pop();
  }
  return lines.join('\n').trim();
}

function describeTrigger(nodes: Array<Record<string, unknown>>): string {
  for (const node of nodes) {
    if ('scheduleTrigger' in node) {
      const t = node.scheduleTrigger as { type?: string; cron?: string; interval?: number };
      if (t?.type === 'cron') return `cron: ${t.cron ?? '(missing)'}`;
      if (t?.type === 'interval') return `interval: ${t.interval ?? 0}ms`;
    }
    if ('webhookTrigger' in node) {
      const t = node.webhookTrigger as { method?: string; path?: string };
      return `webhook: ${t.method ?? 'GET'} ${t.path ?? '/'}`;
    }
    if ('discordTrigger' in node) {
      const t = node.discordTrigger as { kind?: string; channel?: string };
      return `discord:${t.kind ?? '?'} channel=${t.channel ?? '*'}`;
    }
    if ('telegramTrigger' in node) {
      const t = node.telegramTrigger as { kind?: string; command?: string };
      return `telegram:${t.kind ?? '?'}${t.command ? ` command=/${t.command}` : ''}`;
    }
  }
  return 'manual';
}
