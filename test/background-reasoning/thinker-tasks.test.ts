// W6 Y4 · 5 task module unit tests.

import { describe, expect, test } from 'bun:test';
import { runWorkflowProposal } from '../../src/background-reasoning/thinker-tasks/workflow-proposal';
import { runTemplateDraft } from '../../src/background-reasoning/thinker-tasks/template-draft';
import { runPatternDetect } from '../../src/background-reasoning/thinker-tasks/pattern-detect';
import { runPersonalization } from '../../src/background-reasoning/thinker-tasks/personalization';
import { runPromptPatch } from '../../src/background-reasoning/thinker-tasks/prompt-patch';
import type {
  KgsCardRef,
  ThinkerLlmCallable,
} from '../../src/background-reasoning/thinker-tasks/types';

const modelSpec = { provider: 'cloud' as const, model: 'gemini-2.5-pro', longContext: true };

function card(over: Partial<KgsCardRef> = {}): KgsCardRef {
  return { id: 'c', kind: 'note', excerpt: 'x', ts: '2026-05-12T00:00:00Z', ...over };
}

function fixedCallable(text: string): ThinkerLlmCallable {
  return async () => ({ text });
}

describe('runWorkflowProposal', () => {
  test('splits rationale + yaml on `---`', async () => {
    const cb = fixedCallable('We see a daily push pattern.\n---\nname: daily-push\ndescription: x\nnodes: []');
    const out = await runWorkflowProposal({ cards: [card()], modelSpec }, cb);
    expect(out.kind).toBe('workflow_proposal');
    expect(out.rationale).toContain('daily push pattern');
    expect(out.yaml).toContain('name: daily-push');
  });

  test('no separator → all text becomes rationale, yaml empty', async () => {
    const cb = fixedCallable('No structured output here.');
    const out = await runWorkflowProposal({ cards: [card()], modelSpec }, cb);
    expect(out.rationale).toContain('No structured');
    expect(out.yaml).toBe('');
  });
});

describe('runTemplateDraft', () => {
  test('parses OMF JSON block', async () => {
    const cb = fixedCallable('prefix\n{"name":"morning-routine","steps":[{"id":"s1","intent":"wake"}],"rationale":"3-step morning"}');
    const out = await runTemplateDraft(
      { routine: { events: [{ kind: 'wake', count: 30, lastTs: '2026-05-12T07:00:00Z' }] }, recentCards: [card()], modelSpec },
      cb,
    );
    expect(out.kind).toBe('template_draft');
    expect(out.omf.name).toBe('morning-routine');
    expect(out.rationale).toContain('3-step');
  });

  test('garbage text → empty omf fallback', async () => {
    const cb = fixedCallable('not json at all');
    const out = await runTemplateDraft(
      { routine: { events: [] }, recentCards: [], modelSpec },
      cb,
    );
    expect(out.omf.name).toBe('untitled');
  });
});

describe('runPatternDetect', () => {
  test('parses JSON with affected[] + suggestion', async () => {
    const cb = fixedCallable('{"affected":["wf-a","wf-b"],"suggestion":"merge them"}');
    const out = await runPatternDetect(
      { routine: { events: [] }, recentWorkflowNames: ['wf-a', 'wf-b'], modelSpec },
      cb,
    );
    expect(out.affected).toEqual(['wf-a', 'wf-b']);
    expect(out.suggestion).toBe('merge them');
  });
});

describe('runPersonalization', () => {
  test('parses update map', async () => {
    const cb = fixedCallable('{"update":{"voiceWakeWord":"hey elanous","sensitivity":0.6}}');
    const out = await runPersonalization(
      {
        target: 'voice',
        feedback: [{ intentKind: 'voice.wake', outcome: 'success', ts: '2026-05-12T01:00:00Z' }],
        modelSpec,
      },
      cb,
    );
    expect(out.update.voiceWakeWord).toBe('hey elanous');
    expect(out.update.sensitivity).toBe(0.6);
  });
});

describe('runPromptPatch', () => {
  test('splits rationale + patch on `---`', async () => {
    const cb = fixedCallable('Failures suggest verbose tone.\n---\nYou are a concise assistant. Always answer in one paragraph.');
    const out = await runPromptPatch(
      {
        target: 'skill',
        targetName: 'omni-digest',
        failures: [card({ kind: 'incident', excerpt: 'too verbose' })],
        currentPrompt: 'You write summaries.',
        modelSpec,
      },
      cb,
    );
    expect(out.target).toBe('skill');
    expect(out.targetName).toBe('omni-digest');
    expect(out.patch).toContain('concise');
    expect(out.rationale).toContain('verbose tone');
  });
});
