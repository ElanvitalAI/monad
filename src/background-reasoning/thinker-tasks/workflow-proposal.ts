// W6 Y4 · workflow proposal task — KGS pattern → workflow YAML.
// Cf. ROADMAP §4.3 output kind 'workflow_proposal' (S19 핵심).

import type {
  KgsCardRef,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './types.js';
import type { ThinkerModelSpec } from '../thinker-model-selector.js';

export interface WorkflowProposalInput {
  cards: KgsCardRef[];
  patternHint?: string;
  modelSpec: ThinkerModelSpec;
  signal?: AbortSignal;
}

function buildPrompt(input: WorkflowProposalInput): string {
  const cardsList = input.cards
    .map((c) => `- [${c.kind}] ${c.ts} :: ${c.excerpt}`)
    .join('\n');
  const hint = input.patternHint ? `\n\nDetected pattern: ${input.patternHint}` : '';
  return [
    'You are proposing a new workflow YAML. Read the recent KGS cards below,',
    'identify the repeated activity, and propose a workflow.',
    '',
    'Return two sections separated by `---`:',
    '1. Rationale (1-2 paragraphs explaining the recurring pattern)',
    '2. YAML — single workflow definition (name + description + nodes[])',
    '',
    `Cards:${hint}`,
    cardsList,
  ].join('\n');
}

function splitYamlFromRationale(text: string): { rationale: string; yaml: string } {
  const idx = text.indexOf('---');
  if (idx === -1) {
    return { rationale: text.trim(), yaml: '' };
  }
  return {
    rationale: text.slice(0, idx).trim(),
    yaml: text.slice(idx + 3).trim(),
  };
}

export async function runWorkflowProposal(
  input: WorkflowProposalInput,
  callable: ThinkerLlmCallable,
): Promise<Extract<ThinkerOutput, { kind: 'workflow_proposal' }>> {
  const out = await callable({
    prompt: buildPrompt(input),
    modelSpec: input.modelSpec,
    longContext: true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const { rationale, yaml } = splitYamlFromRationale(out.text);
  return { kind: 'workflow_proposal', yaml, rationale };
}
