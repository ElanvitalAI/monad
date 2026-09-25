// W6 Y4 · orchestrator integration — fire matrix + task fan-out + writer call.

import { describe, expect, test } from 'bun:test';
import { ThinkerModelSelector } from '../../src/background-reasoning/thinker-model-selector';
import {
  ThinkerTrigger,
  DEFAULT_THINKER_THRESHOLDS,
} from '../../src/background-reasoning/thinker-trigger';
import {
  tickThinker,
  type ThinkerInputBag,
  type ThinkerWriter,
} from '../../src/background-reasoning/thinker';
import type {
  KgsCardRef,
  ThinkerLlmCallable,
  ThinkerOutput,
} from '../../src/background-reasoning/thinker-tasks/types';

function card(i: number): KgsCardRef {
  return { id: `c${i}`, kind: 'note', excerpt: `excerpt ${i}`, ts: '2026-05-12T00:00:00Z' };
}

function makeWriter(): ThinkerWriter & { persisted: ThinkerOutput[] } {
  const persisted: ThinkerOutput[] = [];
  return { persisted, persist: async (outs) => { persisted.push(...outs); } };
}

function deps(over: { callable?: ThinkerLlmCallable; localAvail?: boolean } = {}) {
  const trigger = new ThinkerTrigger({ now: () => 1_000_001 });
  const selector = new ThinkerModelSelector({ local2Available: () => over.localAvail ?? true });
  const callable: ThinkerLlmCallable = over.callable ?? (async (i) => ({ text: `answer for ${i.modelSpec.model}` }));
  const writer = makeWriter();
  return { trigger, selector, callable, writer };
}

const baseState = {
  kgsNewCardsSinceLast: 0,
  kgsNewEntitiesSinceLast: 0,
  daysSinceLast: 0,
  lastFiredAt: 1_000_000,
};

describe('tickThinker', () => {
  test('no fire on cold state', async () => {
    const d = deps();
    const out = await tickThinker(baseState, [], { cards: [] }, d);
    expect(out.fired).toBe(false);
    expect(out.outputs.length).toBe(0);
    expect(d.writer.persisted.length).toBe(0);
  });

  test('kgs-threshold fires + workflow_proposal when ≥3 cards', async () => {
    const cards = [card(1), card(2), card(3)];
    const d = deps({ callable: async () => ({ text: 'rationale text\n---\nname: derived' }) });
    const out = await tickThinker(
      { ...baseState, kgsNewCardsSinceLast: DEFAULT_THINKER_THRESHOLDS.kgsNewCardsMax },
      [],
      { cards },
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.reason).toBe('kgs-threshold');
    expect(out.attempted).toContain('workflow_proposal');
    expect(out.outputs.length).toBe(1);
    expect(out.outputs[0]!.kind).toBe('workflow_proposal');
    expect(d.writer.persisted.length).toBe(1);
  });

  test('multi-task fan-out (workflow + template + pattern + personalization)', async () => {
    const bag: ThinkerInputBag = {
      cards: Array.from({ length: 5 }, (_, i) => card(i)),
      routine: { events: Array.from({ length: 12 }, (_, i) => ({ kind: `k${i}`, count: 5, lastTs: '2026-05-12T01:00:00Z' })) },
      recentWorkflowNames: ['wf-a', 'wf-b'],
      intentFeedback: [{ intentKind: 'tui.utterance.chat_submit', outcome: 'success', ts: '2026-05-12T02:00:00Z' }],
    };
    const d = deps({
      callable: async (input) => {
        if (input.prompt.includes('OMF')) return { text: '{"name":"r","steps":[],"rationale":"ok"}' };
        if (input.prompt.includes('cross-workflow')) return { text: '{"affected":["wf-a"],"suggestion":"merge"}' };
        if (input.prompt.includes('personalization')) return { text: '{"update":{"x":1}}' };
        return { text: 'rationale\n---\nname: y' };
      },
    });
    const out = await tickThinker(
      { ...baseState, kgsNewCardsSinceLast: DEFAULT_THINKER_THRESHOLDS.kgsNewCardsMax },
      [],
      bag,
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.attempted.sort()).toEqual(['pattern_detect', 'personalization', 'template_draft', 'workflow_proposal']);
    expect(out.outputs.length).toBe(4);
    const kinds = out.outputs.map((o) => o.kind).sort();
    expect(kinds).toEqual(['cross_workflow_pattern', 'personalization_update', 'template_draft', 'workflow_proposal']);
  });

  test('per-task error does not abort the tick', async () => {
    let calls = 0;
    const d = deps({
      callable: async () => {
        calls++;
        if (calls === 1) throw new Error('first task fail');
        return { text: '{"affected":["wf-a"],"suggestion":"ok"}' };
      },
    });
    const out = await tickThinker(
      { ...baseState, daysSinceLast: 2 },
      [],
      {
        cards: [card(1), card(2), card(3)],
        routine: { events: [] },
        recentWorkflowNames: ['wf-a', 'wf-b'],
      },
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.outputs.length).toBe(1);
    expect(out.outputs[0]!.kind).toBe('cross_workflow_pattern');
  });

  test('emergency signal fires even without input bag content', async () => {
    const d = deps();
    const out = await tickThinker(
      baseState,
      [{ schema_version: 1, id: 's', source: 't', tier: 'emergency', ts: '2026-05-12T00:00:00Z', message: '' }],
      { cards: [] },
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.reason).toBe('emergency');
    // No tasks to fire, but it fired and writer was not called.
    expect(out.outputs.length).toBe(0);
    expect(d.writer.persisted.length).toBe(0);
  });

  test('prompt_patch fires per failingTarget', async () => {
    const d = deps({ callable: async () => ({ text: 'why\n---\nnew prompt body' }) });
    const out = await tickThinker(
      { ...baseState, daysSinceLast: 2 },
      [],
      {
        cards: [],
        failingTargets: [
          { target: 'skill', targetName: 'omni-digest', currentPrompt: 'old', failures: [card(1)] },
          { target: 'persona', targetName: 'reviewer', currentPrompt: 'old2', failures: [card(2)] },
        ],
      },
      d,
    );
    expect(out.fired).toBe(true);
    expect(out.outputs.length).toBe(2);
    expect(out.outputs.every((o) => o.kind === 'prompt_patch')).toBe(true);
  });
});
