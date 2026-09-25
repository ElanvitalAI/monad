// W6 Y4 · template draft task — routine → OMF template (S22 marketplace funnel).
// Cf. ROADMAP §4.3 output kind 'template_draft'.

import type {
  KgsCardRef,
  RoutineSnapshot,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './types.js';
import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface TemplateDraftInput {
  routine: RoutineSnapshot;
  recentCards: KgsCardRef[];
  modelSpec: ThinkerModelSpec;
  signal?: AbortSignal;
}

function buildPrompt(input: TemplateDraftInput): string {
  const routine = input.routine.events
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((e) => `- ${e.kind}: ${e.count}× (last ${e.lastTs})`)
    .join('\n');
  const cards = input.recentCards.map((c) => `- ${c.kind}: ${c.excerpt}`).join('\n');
  return [
    'Draft an OMF (Open Mission Format) template from the routine + recent cards.',
    '',
    'Return JSON (only):',
    '{ "name": "...", "description": "...", "steps": [{"id": "...", "intent": "..."}], "rationale": "..." }',
    '',
    'Routine (30-day):',
    routine,
    '',
    'Recent cards:',
    cards,
  ].join('\n');
}

function parseOmf(text: string): { omf: Record<string, unknown>; rationale: string } {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { omf: { name: 'untitled', steps: [] }, rationale: trimmed };
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
    return { omf: parsed, rationale };
  } catch {
    return { omf: { name: 'untitled', steps: [] }, rationale: 'parse-failed' };
  }
}

export async function runTemplateDraft(
  input: TemplateDraftInput,
  callable: ThinkerLlmCallable,
): Promise<Extract<ThinkerOutput, { kind: 'template_draft' }>> {
  const out = await callable({
    prompt: buildPrompt(input),
    modelSpec: input.modelSpec,
    longContext: true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const { omf, rationale } = parseOmf(out.text);
  return { kind: 'template_draft', omf, rationale };
}
