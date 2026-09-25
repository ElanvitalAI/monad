// AXON F4 — AskUserQuestion.delivery pass-through unit tests.
//
// Covers three layers:
//   1. parseQuestionRequest accepts/rejects the delivery enum
//   2. Tool spec schema advertises the enum
//   3. dispatchAskUserQuestion routes based on delivery (non-TUI
//      without a resolver errors; non-TUI with a resolver calls it;
//      TUI-compatible delivery keeps existing fallback behaviour)

import { describe, test, expect, afterEach } from 'bun:test';
import {
  ASK_USER_QUESTION_DELIVERY_VALUES,
  parseQuestionRequest,
  type HitlDelivery,
} from '../../src/ask-user-question/types.js';
import {
  buildAskUserQuestionTool,
  dispatchAskUserQuestion,
  setAskUserQuestionDeps,
  setAskUserQuestionResolver,
  _clearQuestionResultListenersForTesting,
  type AskUserQuestionResolver,
} from '../../src/ask-user-question/index.js';

const VALID_REQUEST = {
  questions: [{
    id: 'fmt',
    header: 'Format',
    question: 'Use Prettier or keep ESLint style?',
    options: [
      { label: 'Prettier', description: 'Auto-format on save' },
      { label: 'ESLint',   description: 'Keep existing rules' },
    ],
  }],
};

describe('AXON F4 — parseQuestionRequest delivery handling', () => {
  test('omitted delivery remains undefined on the parsed request', () => {
    const p = parseQuestionRequest({ ...VALID_REQUEST });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.req.delivery).toBeUndefined();
    }
  });

  test('every HitlDelivery enum value parses', () => {
    for (const v of ASK_USER_QUESTION_DELIVERY_VALUES) {
      const p = parseQuestionRequest({ ...VALID_REQUEST, delivery: v });
      expect(p.ok).toBe(true);
      if (p.ok) expect(p.req.delivery).toBe(v);
    }
  });

  test('invalid delivery value is rejected with a clear reason', () => {
    const p = parseQuestionRequest({ ...VALID_REQUEST, delivery: 'telegarm' as HitlDelivery });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.reason).toContain('delivery must be one of');
      expect(p.reason).toContain('telegarm');
    }
  });

  test('non-string delivery (number, object) is rejected', () => {
    const p1 = parseQuestionRequest({ ...VALID_REQUEST, delivery: 42 as unknown as HitlDelivery });
    expect(p1.ok).toBe(false);
    const p2 = parseQuestionRequest({ ...VALID_REQUEST, delivery: {} as unknown as HitlDelivery });
    expect(p2.ok).toBe(false);
  });
});

describe('AXON F4 — tool schema advertises delivery', () => {
  test('spec.parameters includes delivery enum', () => {
    const spec = buildAskUserQuestionTool();
    const params = spec.parameters as { properties: Record<string, unknown> };
    expect(params.properties.delivery).toBeDefined();
    const delivery = params.properties.delivery as { enum?: string[]; type?: string };
    expect(delivery.type).toBe('string');
    expect(delivery.enum).toEqual([...ASK_USER_QUESTION_DELIVERY_VALUES]);
  });

  test('delivery is NOT required (backward compat for pre-F4 callers)', () => {
    const spec = buildAskUserQuestionTool();
    const params = spec.parameters as { required: string[] };
    expect(params.required).toEqual(['questions']);
    expect(params.required).not.toContain('delivery');
  });
});

describe('AXON F4 — dispatchAskUserQuestion delivery routing', () => {
  afterEach(() => {
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(null);
    _clearQuestionResultListenersForTesting();
  });

  test("delivery='telegram' without a resolver returns a structured error", async () => {
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(null);
    const r = await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'telegram' });
    expect(r.output).toContain("delivery='telegram'");
    expect(r.output).toContain('HITL resolver');
    expect(r.result).toBeUndefined();
    expect(r.absenceReason).toBe('no-delivery-resolver');
  });

  test("delivery='telegram' with a resolver invokes the resolver with req.delivery='telegram'", async () => {
    let receivedDelivery: HitlDelivery | undefined;
    const resolver: AskUserQuestionResolver = async (req) => {
      receivedDelivery = req.delivery;
      return { answers: { [req.questions[0]!.id]: 'Prettier' } };
    };
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'telegram' });
    expect(receivedDelivery).toBe('telegram');
    expect(r.result).toBeDefined();
    expect(r.result!.answers.fmt).toBe('Prettier');
  });

  test("delivery='all' with a resolver forwards the fan-out hint", async () => {
    const seen: HitlDelivery[] = [];
    setAskUserQuestionResolver(async (req) => {
      if (req.delivery) seen.push(req.delivery);
      return { answers: { [req.questions[0]!.id]: 'ESLint' } };
    });
    await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'all' });
    expect(seen).toEqual(['all']);
  });

  test("delivery='modal' preserves the original AU4 fallback (no deps + no resolver ⇒ generic error)", async () => {
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(null);
    const r = await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'modal' });
    // Falls through to the pre-F4 "not available in this surface" error,
    // NOT the F4-specific "requires a HITL resolver" error.
    expect(r.output).toContain('not available in this surface');
    expect(r.output).not.toContain("delivery='modal'");
  });

  test("delivery='terminal' is treated as TUI-compatible", async () => {
    // Resolver installed; with delivery='terminal' the dispatcher
    // prefers the (absent) TUI path and then falls back to the
    // resolver per AU4 — same as an unset delivery.
    const resolver: AskUserQuestionResolver = async (req) => ({
      answers: { [req.questions[0]!.id]: 'ESLint' },
    });
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'terminal' });
    expect(r.result).toBeDefined();
    expect(r.result!.answers.fmt).toBe('ESLint');
  });

  test("unset delivery behaves identically to pre-F4 AU4 path", async () => {
    const resolver: AskUserQuestionResolver = async (req) => ({
      answers: { [req.questions[0]!.id]: 'Prettier' },
    });
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion(VALID_REQUEST);
    expect(r.result!.answers.fmt).toBe('Prettier');
  });
});
