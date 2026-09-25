// Unit tests for the `monad/ask/*` extMethod schema — cross-surface
// AskUserQuestion wire. Sibling tests to acp-monad-ui-extensions.test.ts.
//
// 2026-05-13 정정: extMethod 패턴 채택으로 schema 가 envelope-in-text 에서
// method-name 상수 + payload validator 로 전환됨.

import { describe, expect, test } from 'bun:test';

import {
  MONAD_ASK_CANCEL_METHOD,
  MONAD_ASK_DISABLED,
  MONAD_ASK_FULL,
  MONAD_ASK_REQUEST_METHOD,
  coerceAskResult,
  emitMonadAskCapabilitiesMeta,
  parseMonadAskCancelPayload,
  parseMonadAskCapabilities,
  parseMonadAskRequestPayload,
  type MonadAskCancelPayload,
  type MonadAskRequestPayload,
} from '../src/acp/ask-extensions.js';
import type { AskUserQuestionRequest } from '../src/ask-user-question/types.js';

const sampleReq: AskUserQuestionRequest = {
  questions: [
    {
      id: 'next_step',
      header: 'Next step',
      question: 'What should we do next?',
      options: [
        { label: 'Install UI components', description: 'Add Button/Card/Input/Navbar.' },
        { label: 'Build landing page', description: 'Hero + Features sections.' },
        { label: 'Configure dark mode', description: 'Theme tokens + toggle.' },
      ],
      includeOther: true,
    },
  ],
};

describe('method name constants', () => {
  test('method names are stable strings', () => {
    expect(MONAD_ASK_REQUEST_METHOD).toBe('monad/ask/request');
    expect(MONAD_ASK_CANCEL_METHOD).toBe('monad/ask/cancel');
  });
});

describe('parseMonadAskRequestPayload', () => {
  test('valid request payload survives the round trip', () => {
    const payload: MonadAskRequestPayload = { id: 'ask-1', request: sampleReq };
    const parsed = parseMonadAskRequestPayload(payload);
    expect(parsed?.id).toBe('ask-1');
    expect(parsed?.request.questions[0]?.id).toBe('next_step');
    expect(parsed?.request.questions[0]?.options).toHaveLength(3);
  });

  test('non-object input returns null', () => {
    expect(parseMonadAskRequestPayload(null)).toBeNull();
    expect(parseMonadAskRequestPayload(undefined)).toBeNull();
    expect(parseMonadAskRequestPayload('hello')).toBeNull();
    expect(parseMonadAskRequestPayload(42)).toBeNull();
  });

  test('missing id returns null', () => {
    expect(parseMonadAskRequestPayload({ request: sampleReq })).toBeNull();
    expect(parseMonadAskRequestPayload({ id: '', request: sampleReq })).toBeNull();
    expect(parseMonadAskRequestPayload({ id: 42, request: sampleReq })).toBeNull();
  });

  test('missing or malformed request.questions returns null', () => {
    expect(parseMonadAskRequestPayload({ id: 'x', request: {} })).toBeNull();
    expect(parseMonadAskRequestPayload({ id: 'x', request: { questions: [] } })).toBeNull();
    expect(parseMonadAskRequestPayload({ id: 'x', request: { questions: 'not array' } })).toBeNull();
  });
});

describe('parseMonadAskCancelPayload', () => {
  test('cancel payload with reason round-trips', () => {
    const payload: MonadAskCancelPayload = { id: 'ask-7', reason: 'turn aborted' };
    const parsed = parseMonadAskCancelPayload(payload);
    expect(parsed?.id).toBe('ask-7');
    expect(parsed?.reason).toBe('turn aborted');
  });

  test('cancel without reason omits the field', () => {
    const parsed = parseMonadAskCancelPayload({ id: 'ask-9' });
    expect(parsed?.id).toBe('ask-9');
    expect(parsed?.reason).toBeUndefined();
  });

  test('missing id returns null', () => {
    expect(parseMonadAskCancelPayload({})).toBeNull();
    expect(parseMonadAskCancelPayload({ id: '' })).toBeNull();
    expect(parseMonadAskCancelPayload(null)).toBeNull();
  });
});

describe('coerceAskResult', () => {
  test('valid result passes through', () => {
    const result = coerceAskResult({
      answers: { next_step: 'Build landing page' },
    });
    expect(result.answers).toEqual({ next_step: 'Build landing page' });
    expect(result.cancelled).toBeUndefined();
  });

  test('multiSelect array values pass through', () => {
    const result = coerceAskResult({
      answers: { features: ['A', 'B', 'C'] },
    });
    expect(result.answers).toEqual({ features: ['A', 'B', 'C'] });
  });

  test('otherText survives', () => {
    const result = coerceAskResult({
      answers: { q: 'Other' },
      otherText: { q: '인터넷 검색해줘' },
    });
    expect(result.otherText).toEqual({ q: '인터넷 검색해줘' });
  });

  test('cancelled=true preserved', () => {
    const result = coerceAskResult({ answers: {}, cancelled: true });
    expect(result.cancelled).toBe(true);
  });

  test('cancelled=false omitted (matches schema · default)', () => {
    const result = coerceAskResult({ answers: { q: 'A' }, cancelled: false });
    expect(result.cancelled).toBeUndefined();
  });

  test('malformed answer values are dropped silently', () => {
    const result = coerceAskResult({
      answers: { good: 'A', bad: 42, alsoBad: { nested: 'object' } },
    });
    expect(result.answers).toEqual({ good: 'A' });
  });

  test('non-object input degrades to cancelled (safer than infinite wait)', () => {
    expect(coerceAskResult(null).cancelled).toBe(true);
    expect(coerceAskResult(undefined).cancelled).toBe(true);
    expect(coerceAskResult('garbage').cancelled).toBe(true);
    expect(coerceAskResult(null).answers).toEqual({});
  });

  test('malformed otherText is filtered', () => {
    const result = coerceAskResult({
      answers: { q: 'Other' },
      otherText: { q: 'valid', bad: 42 },
    });
    expect(result.otherText).toEqual({ q: 'valid' });
  });

  test('empty otherText is omitted entirely', () => {
    const result = coerceAskResult({
      answers: { q: 'A' },
      otherText: { bad: 42 },  // all filtered
    });
    expect(result.otherText).toBeUndefined();
  });
});

describe('capabilities', () => {
  test('parseMonadAskCapabilities returns disabled for missing _meta', () => {
    expect(parseMonadAskCapabilities(undefined)).toEqual(MONAD_ASK_DISABLED);
    expect(parseMonadAskCapabilities({})).toEqual(MONAD_ASK_DISABLED);
    expect(parseMonadAskCapabilities({ monad: {} })).toEqual(MONAD_ASK_DISABLED);
    expect(parseMonadAskCapabilities({ monad: { ask: {} } })).toEqual(MONAD_ASK_DISABLED);
  });

  test('parseMonadAskCapabilities honours askUserQuestion=true', () => {
    const meta = { monad: { ask: { askUserQuestion: true } } };
    expect(parseMonadAskCapabilities(meta)).toEqual(MONAD_ASK_FULL);
  });

  test('emitMonadAskCapabilitiesMeta round-trips', () => {
    const emitted = emitMonadAskCapabilitiesMeta(MONAD_ASK_FULL);
    expect(parseMonadAskCapabilities(emitted)).toEqual(MONAD_ASK_FULL);
  });

  test('explicitly disabled capability stays disabled', () => {
    const meta = { monad: { ask: { askUserQuestion: false } } };
    expect(parseMonadAskCapabilities(meta)).toEqual(MONAD_ASK_DISABLED);
  });
});
