// W6 Y4 · pattern-detect task — routine pattern surfacing.
// Cf. ROADMAP §4.3 output 'cross_workflow_pattern'.

import type {
  RoutineSnapshot,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './types.js';
import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface PatternDetectInput {
  routine: RoutineSnapshot;
  /** Workflow names touched in the window — pattern detector hints them. */
  recentWorkflowNames: string[];
  modelSpec: ThinkerModelSpec;
  signal?: AbortSignal;
}

function buildPrompt(input: PatternDetectInput): string {
  const routine = input.routine.events
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((e) => `- ${e.kind}: ${e.count}× (last ${e.lastTs})`)
    .join('\n');
  return [
    'Identify ONE cross-workflow pattern across the routine events.',
    'List the workflow names that share the pattern and propose one improvement.',
    '',
    'Return JSON (only): { "affected": ["wf1", "wf2"], "suggestion": "..." }',
    '',
    `Workflows in window: ${input.recentWorkflowNames.join(', ')}`,
    'Routine:',
    routine,
  ].join('\n');
}

function parseResult(text: string): { affected: string[]; suggestion: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { affected: [], suggestion: text.trim() };
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { affected?: unknown; suggestion?: unknown };
    const affected = Array.isArray(parsed.affected)
      ? parsed.affected.filter((v): v is string => typeof v === 'string')
      : [];
    const suggestion = typeof parsed.suggestion === 'string' ? parsed.suggestion : '';
    return { affected, suggestion };
  } catch {
    return { affected: [], suggestion: 'parse-failed' };
  }
}

export async function runPatternDetect(
  input: PatternDetectInput,
  callable: ThinkerLlmCallable,
): Promise<Extract<ThinkerOutput, { kind: 'cross_workflow_pattern' }>> {
  const out = await callable({
    prompt: buildPrompt(input),
    modelSpec: input.modelSpec,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const parsed = parseResult(out.text);
  return { kind: 'cross_workflow_pattern', affected: parsed.affected, suggestion: parsed.suggestion };
}
