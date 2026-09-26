// ── AU4 — resolver fallback for skill / headless mode ──

import { describe, test, expect, afterEach } from 'bun:test';
import {
  dispatchAskUserQuestion,
  setAskUserQuestionDeps,
  setAskUserQuestionResolver,
  _clearQuestionResultListenersForTesting,
  type AskUserQuestionResolver,
} from '../../src/ask-user-question/index.js';
import { registerDefaultQuestionChannels } from '../../src/hitl/question.js';
import type { AskUserQuestionRequest } from '../../src/ask-user-question/types.js';

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

describe('dispatchAskUserQuestion — AU4 resolver fallback', () => {
  afterEach(() => {
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(null);
    registerDefaultQuestionChannels([]);
    _clearQuestionResultListenersForTesting();
  });

  test('no deps + no resolver → structured "not available" error', async () => {
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(null);
    const r = await dispatchAskUserQuestion(VALID_REQUEST);
    expect(r.output).toMatch(/not available in this surface/);
    expect(r.output).toMatch(/best-guess default/);
    expect(r.result).toBeUndefined();
  });

  test('resolver hook wins when deps are absent', async () => {
    const resolver: AskUserQuestionResolver = async (req) => ({
      answers: { [req.questions[0]!.id]: req.questions[0]!.options[0]!.label },
    });
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion(VALID_REQUEST);
    expect(r.result).toBeDefined();
    expect(r.result!.answers.fmt).toBe('Prettier');
    expect(r.output).toContain('Prettier');
  });

  test('AskBridgeUnavailable is classified as a structured no-capable-peer absence', async () => {
    const resolver: AskUserQuestionResolver = async () => {
      const error = new Error('no elanous/ask cap-able peer attached to session elanous-session-6tidkn');
      error.name = 'AskBridgeUnavailable';
      throw error;
    };
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion({ ...VALID_REQUEST, delivery: 'telegram' });
    expect(r.absenceReason).toBe('no-capable-peer');
    expect(r.output).toContain('no elanous/ask cap-able peer attached');
    expect(r.result).toBeUndefined();
  });

  test('AskBridgeUnavailable falls through to SSE question channel without folding options', async () => {
    const seen: AskUserQuestionRequest[] = [];
    registerDefaultQuestionChannels([{
      name: 'pwa',
      async ask(req) {
        seen.push(req);
        return { answers: { fmt: req.questions[0]!.options[1]!.label } };
      },
      cancel() {},
    }]);
    const resolver: AskUserQuestionResolver = async () => {
      const error = new Error('no elanous/ask cap-able peer attached');
      error.name = 'AskBridgeUnavailable';
      throw error;
    };
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const threeOptions = {
      questions: [{
        id: 'fmt',
        header: 'Format',
        question: 'A, B, or C?',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' },
          { label: 'C', description: 'third' },
        ],
      }],
    };
    const r = await dispatchAskUserQuestion(threeOptions);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.questions[0]!.options.map((o) => o.label)).toEqual(['A', 'B', 'C']);
    expect(r.result?.answers.fmt).toBe('B');
    expect(r.absenceReason).toBeUndefined();
  });

  test('ACP-capable resolver is used before the SSE question channel', async () => {
    let sseAsked = false;
    registerDefaultQuestionChannels([{
      name: 'pwa',
      async ask() {
        sseAsked = true;
        return { answers: { fmt: 'SSE' } };
      },
      cancel() {},
    }]);
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(async () => ({ answers: { fmt: 'ACP' } }));
    const r = await dispatchAskUserQuestion(VALID_REQUEST, { sessionId: 'sess-acp' });
    expect(r.result?.answers.fmt).toBe('ACP');
    expect(sseAsked).toBe(false);
  });

  test('resolver throw surfaces as structured error (not uncaught)', async () => {
    const resolver: AskUserQuestionResolver = async () => {
      throw new Error('host refused');
    };
    setAskUserQuestionDeps(null);
    setAskUserQuestionResolver(resolver);
    const r = await dispatchAskUserQuestion(VALID_REQUEST);
    expect(r.output).toContain('resolver');
    expect(r.output).toContain('host refused');
    expect(r.result).toBeUndefined();
  });

  test('malformed request is rejected before any surface is consulted', async () => {
    let called = false;
    setAskUserQuestionResolver(async () => { called = true; return { answers: {} }; });
    const r = await dispatchAskUserQuestion({ questions: [] });  // < minItems
    expect(r.output).toContain('failed');
    expect(called).toBe(false);
  });
});
