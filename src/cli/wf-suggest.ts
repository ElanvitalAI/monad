// M4-1 (2026-05-12 · Phase 4 N5-1) — `elanous wf suggest-next` CLI.
//
// Loads a workflow by name (project / global / builtin · same lookup
// as `elanous wf show`), calls `suggestNextNodes` with the configured
// LLM, prints the N suggestions to stdout. F3 default: invoked on
// demand · no auto-fire.

import { findWorkflow } from '../workflow-runtime/index.js';
import { suggestNextNodes, type SuggestPosition } from '../workflow-synth/suggest-next-nodes.js';
import * as ui from '../ui.js';

export interface WfSuggestNextOpts {
  intent?: string;
  /** `after:<id>` · `before:<id>` · `parallel` · `append` (default). */
  position?: string;
  count?: number;
}

function parsePosition(raw: string | undefined): SuggestPosition | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === 'append') return { kind: 'append' };
  if (trimmed === 'parallel') return { kind: 'parallel' };
  const after = /^after:(.+)$/.exec(trimmed);
  if (after) return { kind: 'after', nodeId: after[1]!.trim() };
  const before = /^before:(.+)$/.exec(trimmed);
  if (before) return { kind: 'before', nodeId: before[1]!.trim() };
  return undefined;
}

export async function wfSuggestNext(
  workflowName: string,
  opts: WfSuggestNextOpts = {},
): Promise<number> {
  if (!workflowName || workflowName.trim().length === 0) {
    ui.error('suggest-next: <workflow> name is required');
    return 1;
  }
  const entry = findWorkflow(workflowName);
  if (!entry) {
    ui.error(`workflow not found: ${workflowName}`);
    return 1;
  }
  const position = parsePosition(opts.position);
  if (opts.position && !position) {
    ui.error(`invalid --position '${opts.position}' — use after:<id> / before:<id> / parallel / append`);
    return 1;
  }
  // Build CLI deps inline (same pattern as `workflow run` · avoids
  // pulling the daemon graph into a CLI invocation).
  const { buildCliWorkflowDeps } = await import('./workflow.js');
  const deps = buildCliWorkflowDeps();

  const result = await suggestNextNodes({
    workflow: entry.definition,
    ...(opts.intent ? { intent: opts.intent } : {}),
    ...(position ? { position } : {}),
    ...(typeof opts.count === 'number' ? { count: opts.count } : {}),
  }, deps);

  if (!result.ok) {
    ui.error(`suggest-next failed: ${result.error ?? '(no error)'}`);
    return 1;
  }
  if (result.suggestions.length === 0) {
    ui.info('No suggestions returned by the LLM.');
    return 0;
  }
  ui.header(`Suggestions for '${workflowName}' (${result.suggestions.length})`);
  console.log('');
  for (let i = 0; i < result.suggestions.length; i += 1) {
    const s = result.suggestions[i]!;
    const conf = Math.round(s.confidence * 100);
    console.log(`  [${i + 1}] ${s.kind}  (confidence ${conf}%)`);
    if (s.rationale) console.log(`      ${s.rationale}`);
    if (s.skeleton) {
      console.log('');
      for (const line of s.skeleton.split('\n')) {
        console.log(`      ${line}`);
      }
    }
    console.log('');
  }
  return 0;
}
