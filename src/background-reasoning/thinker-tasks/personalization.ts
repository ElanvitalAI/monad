// W6 Y4 · personalization task — voice/motion/timing 학습 update.
// Cf. ROADMAP §4.3 output 'personalization_update'.

import type {
  IntentFeedback,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './types.js';
import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface PersonalizationInput {
  target: string;
  feedback: IntentFeedback[];
  modelSpec: ThinkerModelSpec;
  signal?: AbortSignal;
}

function buildPrompt(input: PersonalizationInput): string {
  const recent = input.feedback
    .slice(-50)
    .map((f) => `- ${f.ts} ${f.intentKind} → ${f.outcome}`)
    .join('\n');
  return [
    `Produce a personalization update for target='${input.target}'.`,
    'Look at the intent feedback (success/fail/ignored) and propose 1-3 setting tweaks.',
    '',
    'Return JSON (only): { "update": { "<key>": <value>, ... } }',
    '',
    'Feedback:',
    recent,
  ].join('\n');
}

function parseUpdate(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { update?: unknown };
    if (parsed.update && typeof parsed.update === 'object') {
      return parsed.update as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function runPersonalization(
  input: PersonalizationInput,
  callable: ThinkerLlmCallable,
): Promise<Extract<ThinkerOutput, { kind: 'personalization_update' }>> {
  const out = await callable({
    prompt: buildPrompt(input),
    modelSpec: input.modelSpec,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const update = parseUpdate(out.text);
  return { kind: 'personalization_update', target: input.target, update };
}
