// Unit tests for the `elanous/ask/*` extMethod schema — cross-surface
// AskUserQuestion wire. Sibling tests to acp-elanous-ui-extensions.test.ts.
//
// 2026-05-13 정정: extMethod 패턴 채택으로 schema 가 envelope-in-text 에서
// method-name 상수 + payload validator 로 전환됨.

import { describe, expect, test } from 'bun:test';

import {
  ELANOUS_ASK_CANCEL_METHOD,
  ELANOUS_ASK_DISABLED,
  ELANOUS_ASK_FULL,
  ELANOUS_ASK_REQUEST_METHOD,
  coerceAskResult,
  emitElanousAskCapabilitiesMeta,
  parseElanousAskCancelPayload,
  parseElanousAskCapabilities,
  parseElanousAskRequestPayload,
  type ElanousAskCancelPayload,
  type ElanousAskRequestPayload,
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
    expect(ELANOUS_ASK_REQUEST_METHOD).toBe('elanous/ask/request');
    expect(ELANOUS_ASK_CANCEL_METHOD).toBe('elanous/ask/cancel');
  });
});

describe('parseElanousAskRequestPayload', () => {
  test('valid request payload survives the round trip', () => {
    const payload: ElanousAskRequestPayload = { id: 'ask-1', request: sampleReq };
    const parsed = parseElanousAskRequestPayload(payload);
    expect(parsed?.id).toBe('ask-1');
    expect(parsed?.request.questions[0]?.id).toBe('next_step');
    expect(parsed?.request.questions[0]?.options).toHaveLength(3);
  });

  test('non-object input returns null', () => {
    expect(parseElanousAskRequestPayload(null)).toBeNull();
    expect(parseElanousAskRequestPayload(undefined)).toBeNull();
    expect(parseElanousAskRequestPayload('hello')).toBeNull();
    expect(parseElanousAskRequestPayload(42)).toBeNull();
  });

  test('missing id returns null', () => {
    expect(parseElanousAskRequestPayload({ request: sampleReq })).toBeNull();
    expect(parseElanousAskRequestPayload({ id: '', request: sampleReq })).toBeNull();
    expect(parseElanousAskRequestPayload({ id: 42, request: sampleReq })).toBeNull();
  });

  test('missing or malformed request.questions returns null', () => {
    expect(parseElanousAskRequestPayload({ id: 'x', request: {} })).toBeNull();
    expect(parseElanousAskRequestPayload({ id: 'x', request: { questions: [] } })).toBeNull();
    expect(parseElanousAskRequestPayload({ id: 'x', request: { questions: 'not array' } })).toBeNull();
  });
});

describe('parseElanousAskCancelPayload', () => {
  test('cancel payload with reason round-trips', () => {
    const payload: ElanousAskCancelPayload = { id: 'ask-7', reason: 'turn aborted' };
    const parsed = parseElanousAskCancelPayload(payload);
    expect(parsed?.id).toBe('ask-7');
    expect(parsed?.reason).toBe('turn aborted');
  });

  test('cancel without reason omits the field', () => {
    const parsed = parseElanousAskCancelPayload({ id: 'ask-9' });
    expect(parsed?.id).toBe('ask-9');
    expect(parsed?.reason).toBeUndefined();
  });

  test('missing id returns null', () => {
    expect(parseElanousAskCancelPayload({})).toBeNull();
    expect(parseElanousAskCancelPayload({ id: '' })).toBeNull();
    expect(parseElanousAskCancelPayload(null)).toBeNull();
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
  test('parseElanousAskCapabilities returns disabled for missing _meta', () => {
    expect(parseElanousAskCapabilities(undefined)).toEqual(ELANOUS_ASK_DISABLED);
    expect(parseElanousAskCapabilities({})).toEqual(ELANOUS_ASK_DISABLED);
    expect(parseElanousAskCapabilities({ elanous: {} })).toEqual(ELANOUS_ASK_DISABLED);
    expect(parseElanousAskCapabilities({ elanous: { ask: {} } })).toEqual(ELANOUS_ASK_DISABLED);
  });

  test('parseElanousAskCapabilities honours askUserQuestion=true', () => {
    const meta = { elanous: { ask: { askUserQuestion: true } } };
    expect(parseElanousAskCapabilities(meta)).toEqual(ELANOUS_ASK_FULL);
  });

  test('emitElanousAskCapabilitiesMeta round-trips', () => {
    const emitted = emitElanousAskCapabilitiesMeta(ELANOUS_ASK_FULL);
    expect(parseElanousAskCapabilities(emitted)).toEqual(ELANOUS_ASK_FULL);
  });

  test('explicitly disabled capability stays disabled', () => {
    const meta = { elanous: { ask: { askUserQuestion: false } } };
    expect(parseElanousAskCapabilities(meta)).toEqual(ELANOUS_ASK_DISABLED);
  });
});
