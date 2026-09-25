// W6 Y4 · prompt-patch task — self-improving loop · skill/persona prompt 갱신 제안.
// Cf. ROADMAP §4.3 output 'prompt_patch'.

import type {
  KgsCardRef,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './types.js';
import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface PromptPatchInput {
  target: 'skill' | 'persona';
  targetName: string;
  /** Recent failure / surprising-result cards informing the patch. */
  failures: KgsCardRef[];
  /** Current prompt text the patcher may rewrite. */
  currentPrompt: string;
  modelSpec: ThinkerModelSpec;
  signal?: AbortSignal;
}

function buildPrompt(input: PromptPatchInput): string {
  const failures = input.failures
    .slice(-10)
    .map((c) => `- ${c.ts} [${c.kind}] :: ${c.excerpt}`)
    .join('\n');
  return [
    `Propose a focused diff to the ${input.target} '${input.targetName}' prompt below.`,
    'Output 2 sections separated by `---`:',
    '1. Rationale (1-2 paragraphs · which failure cluster it addresses)',
    '2. Patch — a literal replacement block (full new prompt, not a diff)',
    '',
    'Recent failures:',
    failures,
    '',
    'Current prompt:',
    input.currentPrompt,
  ].join('\n');
}

function splitPatch(text: string): { rationale: string; patch: string } {
  const idx = text.indexOf('---');
  if (idx === -1) return { rationale: text.trim(), patch: '' };
  return {
    rationale: text.slice(0, idx).trim(),
    patch: text.slice(idx + 3).trim(),
  };
}

export async function runPromptPatch(
  input: PromptPatchInput,
  callable: ThinkerLlmCallable,
): Promise<Extract<ThinkerOutput, { kind: 'prompt_patch' }>> {
  const out = await callable({
    prompt: buildPrompt(input),
    modelSpec: input.modelSpec,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const { rationale, patch } = splitPatch(out.text);
  return {
    kind: 'prompt_patch',
    target: input.target,
    targetName: input.targetName,
    patch,
    rationale,
  };
}
