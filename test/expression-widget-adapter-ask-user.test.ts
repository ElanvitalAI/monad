// ── ask-user-question ↔ InteractiveModal adapter (LT 6) ──
//
// Pins the round-trip mapping for the LLM-driven AskUserQuestion path:
//   1. Single-question single-select → 1 picker step + 1 Other text
//      step (when `includeOther !== false`).
//   2. Multi-question chain — each Question emits its own picker;
//      Other-text step injected per question that opts in.
//   3. Multi-select picker preserves `multi: true`.
//   4. Result back-translation maps option ids → human-readable labels
//      and folds Other-text into `otherText[questionId]` only when the
//      Other option was actually picked.
//   5. Cancellation propagates with partial answers.
//   6. `includeOther: false` suppresses the Other entry + the text step.

import { describe, expect, test } from 'bun:test';
import {
  askUserRequestToInteractiveModalSpec,
  interactiveModalResultToAnswer,
  OTHER_LABEL,
  OTHER_TEXT_FIELD_SUFFIX,
} from '../src/expression/widget/adapters/ask-user';
import type {
  AskUserQuestionRequest,
  Question,
} from '../src/ask-user-question/types';
import type { InteractiveModalResult } from '../src/expression/widget/interactive-modal';

const SINGLE: Question = {
  id: 'tone',
  header: 'Tone',
  question: 'Which tone fits this PR description?',
  options: [
    { label: 'Concise', description: 'one paragraph, bullet list' },
    { label: 'Detailed', description: 'sections + before/after' },
  ],
};

const MULTI: Question = {
  id: 'fixes',
  header: 'Fixes',
  question: 'Which areas need fixes?',
  options: [
    { label: 'Auth', description: 'sign-in flow' },
    { label: 'API', description: 'endpoint validation' },
    { label: 'UI', description: 'modal state' },
  ],
  multiSelect: true,
};

const NO_OTHER: Question = {
  ...SINGLE,
  id: 'risk',
  header: 'Risk',
  question: 'Risk tier?',
  includeOther: false,
};

describe('askUserRequestToInteractiveModalSpec', () => {
  test('single question + default includeOther → picker + text step', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const spec = askUserRequestToInteractiveModalSpec(req);
    expect(spec.kind).toBe('interactive-modal');
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[0].kind).toBe('pick');
    expect(spec.steps[0].id).toBe('tone');
    expect(spec.steps[1].kind).toBe('text');
    expect(spec.steps[1].id).toBe(`tone${OTHER_TEXT_FIELD_SUFFIX}`);

    // The picker step has the canned options + an Other entry.
    const items = (spec.steps[0] as { items: ReadonlyArray<{ id: string; label: string; description?: string }> }).items;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ id: 'tone__opt0', label: 'Concise', description: 'one paragraph, bullet list' });
    expect(items[2].id).toBe('tone__other');
    expect(items[2].label).toBe(OTHER_LABEL);
  });

  test('includeOther:false → no Other entry + no text step', () => {
    const spec = askUserRequestToInteractiveModalSpec({ questions: [NO_OTHER] });
    expect(spec.steps).toHaveLength(1);
    const items = (spec.steps[0] as { items: ReadonlyArray<{ id: string }> }).items;
    expect(items.every((it) => !it.id.endsWith('__other'))).toBe(true);
  });

  test('multiSelect propagates as multi:true on the picker step', () => {
    const spec = askUserRequestToInteractiveModalSpec({ questions: [MULTI] });
    const picker = spec.steps[0] as { multi?: boolean };
    expect(picker.multi).toBe(true);
  });

  test('multi-question request emits one picker (+ optional text) per question', () => {
    const spec = askUserRequestToInteractiveModalSpec({
      questions: [SINGLE, MULTI, NO_OTHER],
    });
    // SINGLE: pick + text · MULTI: pick + text · NO_OTHER: pick → 5
    expect(spec.steps).toHaveLength(5);
    const ids = spec.steps.map((s) => s.id);
    expect(ids).toEqual([
      'tone',
      `tone${OTHER_TEXT_FIELD_SUFFIX}`,
      'fixes',
      `fixes${OTHER_TEXT_FIELD_SUFFIX}`,
      'risk',
    ]);
  });

  test('throws when questions array is empty', () => {
    expect(() =>
      askUserRequestToInteractiveModalSpec({ questions: [] }),
    ).toThrow();
  });

  test('opts.title overrides the synthesized header', () => {
    const spec = askUserRequestToInteractiveModalSpec(
      { questions: [SINGLE] },
      { title: 'Custom title' },
    );
    expect(spec.title).toBe('Custom title');
  });

  test('opts.excerpt = empty string suppresses the excerpt entirely', () => {
    const spec = askUserRequestToInteractiveModalSpec(
      { questions: [SINGLE] },
      { excerpt: '' },
    );
    expect((spec as { excerpt?: string }).excerpt).toBeUndefined();
  });
});

describe('interactiveModalResultToAnswer', () => {
  test('single-select → label string keyed by question id', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: { tone: 'tone__opt1' },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers).toEqual({ tone: 'Detailed' });
    expect(r.answeredBy).toBe('human');
    expect(r.cancelled).toBeUndefined();
    expect(r.otherText).toBeUndefined();
  });

  test('multi-select → array of labels', () => {
    const req: AskUserQuestionRequest = { questions: [MULTI] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: { fixes: ['fixes__opt0', 'fixes__opt2'] },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers).toEqual({ fixes: ['Auth', 'UI'] });
  });

  test('Other selected → label "Other" + free text in otherText[id]', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: {
        tone: 'tone__other',
        [`tone${OTHER_TEXT_FIELD_SUFFIX}`]: 'Mix of both — punchy intro, full detail below',
      },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers).toEqual({ tone: OTHER_LABEL });
    expect(r.otherText).toEqual({
      tone: 'Mix of both — punchy intro, full detail below',
    });
  });

  test('Other text empty → otherText omitted entirely', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: {
        tone: 'tone__other',
        [`tone${OTHER_TEXT_FIELD_SUFFIX}`]: '',
      },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.otherText).toBeUndefined();
  });

  test('canonical option chosen → otherText absent even if text was filled', () => {
    // Defensive: a host that pre-fills the text input shouldn't leak
    // it into the result when the user picked a canned option.
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: {
        tone: 'tone__opt0',
        [`tone${OTHER_TEXT_FIELD_SUFFIX}`]: 'leaked text',
      },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers.tone).toBe('Concise');
    expect(r.otherText).toBeUndefined();
  });

  test('cancel propagates with whatever answers were collected', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE, MULTI] };
    const modal: InteractiveModalResult = {
      status: 'cancel',
      answers: { tone: 'tone__opt0' },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.cancelled).toBe(true);
    // ⭐ 취소여도 «답이 있었으면» 사람이 답한 것이다 — 취소를 이유로 provenance 를 버리면
    //    「아무도 안 답했다」가 거짓이 된다(무인 리뷰 R5 must-fix).
    expect(r.answeredBy).toBe('human');
    expect(r.answers).toEqual({ tone: 'Concise' });
  });

  test('⛔ 취소이고 «답이 0개»면 provenance 를 기록하지 않는다 — 「아무 답도 없음 ⇒ none」', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE, MULTI] };
    const r = interactiveModalResultToAnswer(req, { status: 'cancel', answers: {} });
    expect(r.cancelled).toBe(true);
    expect(r.answeredBy).toBeUndefined();
  });

  test('unknown option id falls through as raw string (defensive)', () => {
    const req: AskUserQuestionRequest = { questions: [SINGLE] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: { tone: 'tone__unknown' },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers.tone).toBe('tone__unknown');
  });

  test('multi-select with Other inside the array folds otherText', () => {
    const req: AskUserQuestionRequest = { questions: [MULTI] };
    const modal: InteractiveModalResult = {
      status: 'done',
      answers: {
        fixes: ['fixes__opt1', 'fixes__other'],
        [`fixes${OTHER_TEXT_FIELD_SUFFIX}`]: 'logging',
      },
    };
    const r = interactiveModalResultToAnswer(req, modal);
    expect(r.answers).toEqual({ fixes: ['API', OTHER_LABEL] });
    expect(r.otherText).toEqual({ fixes: 'logging' });
  });
});
