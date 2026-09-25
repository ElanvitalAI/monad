// CV-3 mobile-readiness #1 · pure-helper tests for the
// useIntentPrediction hook.
//
// Pattern mirror: use-hitl-banner.test.ts (β-1a) — the React hook
// itself is exercised in an integration session; here we lock the
// pure helpers extracted from the hook so the entire decision
// surface is unit-covered.

import { describe, expect, test } from 'bun:test';
import {
  buildFeedbackUrl,
  confidenceToIntensity,
  INTENT_BUTTON_LABELS,
  parseRankingFrame,
  sortByConfidence,
  type IntentCandidate,
  type IntentRanking,
} from './use-intent-prediction';

describe('INTENT_BUTTON_LABELS', () => {
  test('canonical 6 labels mirroring server ranker', () => {
    expect([...INTENT_BUTTON_LABELS]).toEqual([
      '계속 진행',
      '오토파일럿',
      '추가 보완',
      'diff 보여줘',
      '승인',
      '잠시 멈춤',
    ]);
  });
});

describe('sortByConfidence', () => {
  function c(label: string, conf: number): IntentCandidate {
    return { label: label as IntentCandidate['label'], confidence: conf, reason: '' };
  }
  test('sorts descending by confidence', () => {
    const sorted = sortByConfidence([
      c('계속 진행', 0.3),
      c('승인', 0.9),
      c('잠시 멈춤', 0.1),
    ]);
    expect(sorted.map((x) => x.label)).toEqual(['승인', '계속 진행', '잠시 멈춤']);
  });
  test('does not mutate the input array', () => {
    const input = [c('계속 진행', 0.3), c('승인', 0.9)];
    sortByConfidence(input);
    expect(input.map((x) => x.label)).toEqual(['계속 진행', '승인']);
  });
});

describe('confidenceToIntensity', () => {
  test('clamps NaN/Infinity to floor (100)', () => {
    expect(confidenceToIntensity(Number.NaN)).toBe(100);
    expect(confidenceToIntensity(Number.POSITIVE_INFINITY)).toBe(100);
  });
  test('0 → floor', () => {
    expect(confidenceToIntensity(0)).toBe(100);
  });
  test('thresholds map to discrete intensities', () => {
    expect(confidenceToIntensity(0.05)).toBe(100);
    expect(confidenceToIntensity(0.15)).toBe(200);
    expect(confidenceToIntensity(0.30)).toBe(300);
    expect(confidenceToIntensity(0.50)).toBe(400);
    expect(confidenceToIntensity(0.70)).toBe(500);
    expect(confidenceToIntensity(0.90)).toBe(600);
    expect(confidenceToIntensity(1.0)).toBe(600);
  });
});

describe('buildFeedbackUrl', () => {
  test('strips trailing slash from baseUrl', () => {
    expect(buildFeedbackUrl('http://x/', 'sess-1'))
      .toBe('http://x/v1/intent-prediction/sess-1/feedback');
  });
  test('encodes the sessionId', () => {
    expect(buildFeedbackUrl('http://x', 'a/b c'))
      .toBe('http://x/v1/intent-prediction/a%2Fb%20c/feedback');
  });
});

describe('parseRankingFrame', () => {
  function valid(): IntentRanking {
    return {
      sessionId: 's1',
      version: 7,
      generatedAt: 1_700_000_000_000,
      candidates: [
        { label: '계속 진행', confidence: 0.5, reason: '' },
        { label: '오토파일럿', confidence: 0.4, reason: '' },
        { label: '추가 보완', confidence: 0.3, reason: '' },
        { label: 'diff 보여줘', confidence: 0.2, reason: '' },
        { label: '승인', confidence: 0.6, reason: '' },
        { label: '잠시 멈춤', confidence: 0.1, reason: '' },
      ],
    };
  }
  test('passes through a well-formed payload', () => {
    expect(parseRankingFrame(valid())).toEqual(valid());
  });
  test('rejects non-object', () => {
    expect(parseRankingFrame(null)).toBeNull();
    expect(parseRankingFrame('not-an-object')).toBeNull();
    expect(parseRankingFrame(7)).toBeNull();
  });
  test('rejects when sessionId is missing/non-string', () => {
    const v = valid() as Partial<IntentRanking>;
    delete v.sessionId;
    expect(parseRankingFrame(v)).toBeNull();
  });
  test('rejects when candidates length ≠ 6', () => {
    const v = valid();
    v.candidates = v.candidates.slice(0, 5);
    expect(parseRankingFrame(v)).toBeNull();
  });
  test('rejects malformed candidate (missing confidence)', () => {
    const v = valid();
    delete (v.candidates[0] as Partial<IntentCandidate>).confidence;
    expect(parseRankingFrame(v)).toBeNull();
  });
  test('rejects when version/generatedAt missing', () => {
    const v = valid() as Partial<IntentRanking>;
    delete v.version;
    expect(parseRankingFrame(v)).toBeNull();
  });
});
