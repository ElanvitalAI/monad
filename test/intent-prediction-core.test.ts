// Intent-prediction core — types + heuristic ranker + version diff.
//
// Covers `src/intent-prediction/{types,ranker,index}.ts`. Pure
// functions all the way; no I/O, no clock.

import { describe, expect, test } from 'bun:test';
import {
  INTENT_BUTTON_LABELS,
  buildRanking,
  isIntentButtonLabel,
  rankIntents,
  rankingsDiffer,
  type IntentContext,
  type IntentRanking,
} from '../src/intent-prediction/index.js';

const baseCtx: IntentContext = {
  sessionId: 'sess-1',
  lastTurnSummary: '',
  lastErr: null,
  progressPct: 0,
  fileEditCount: 0,
  idleMs: 0,
  recentTaps: [],
};

describe('INTENT_BUTTON_LABELS', () => {
  test('canonical 6 labels in stable order', () => {
    expect([...INTENT_BUTTON_LABELS]).toEqual([
      '계속 진행',
      '오토파일럿',
      '추가 보완',
      'diff 보여줘',
      '승인',
      '잠시 멈춤',
    ]);
  });

  test('isIntentButtonLabel narrows valid strings + rejects unknowns', () => {
    expect(isIntentButtonLabel('계속 진행')).toBe(true);
    expect(isIntentButtonLabel('승인')).toBe(true);
    expect(isIntentButtonLabel('잠시 멈춤')).toBe(true);
    expect(isIntentButtonLabel('OTHER')).toBe(false);
    expect(isIntentButtonLabel('')).toBe(false);
    expect(isIntentButtonLabel(null)).toBe(false);
    expect(isIntentButtonLabel(7)).toBe(false);
  });
});

describe('rankIntents', () => {
  function topLabel(ctx: IntentContext): string {
    const ranked = rankIntents(ctx);
    return [...ranked].sort((a, b) => b.confidence - a.confidence)[0]!.label;
  }

  function confOf(ctx: IntentContext, label: string): number {
    const ranked = rankIntents(ctx);
    return ranked.find((c) => c.label === label)!.confidence;
  }

  test('returns one entry per canonical label in stable order', () => {
    const out = rankIntents(baseCtx);
    expect(out).toHaveLength(6);
    expect(out.map((c) => c.label)).toEqual([...INTENT_BUTTON_LABELS]);
  });

  test('all confidences clamped to [0,1]', () => {
    const ranked = rankIntents({
      ...baseCtx,
      lastErr: 'boom',
      progressPct: 1,
      fileEditCount: 99,
      idleMs: 999_999,
      recentTaps: ['승인', '계속 진행', '오토파일럿'],
    });
    for (const c of ranked) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('error path → "잠시 멈춤" wins', () => {
    expect(topLabel({ ...baseCtx, lastErr: 'TypeError: x' })).toBe('잠시 멈춤');
  });

  test('high progress → "승인" wins', () => {
    expect(topLabel({ ...baseCtx, progressPct: 0.85 })).toBe('승인');
  });

  test('mid progress → "계속 진행" boost', () => {
    expect(confOf({ ...baseCtx, progressPct: 0.5 }, '계속 진행')).toBeGreaterThan(
      confOf(baseCtx, '계속 진행'),
    );
  });

  test('many file edits → "diff 보여줘" wins', () => {
    expect(topLabel({ ...baseCtx, fileEditCount: 5 })).toBe('diff 보여줘');
  });

  test('long idle → "오토파일럿" wins', () => {
    expect(topLabel({ ...baseCtx, idleMs: 120_000 })).toBe('오토파일럿');
  });

  test('recency boost: recent tap raises that label', () => {
    const before = confOf(baseCtx, '오토파일럿');
    const after = confOf({ ...baseCtx, recentTaps: ['오토파일럿'] }, '오토파일럿');
    expect(after).toBeGreaterThan(before);
  });

  test('recency dedupe — same label twice doesn\'t double-boost', () => {
    const once = confOf({ ...baseCtx, recentTaps: ['오토파일럿'] }, '오토파일럿');
    const twice = confOf({ ...baseCtx, recentTaps: ['오토파일럿', '오토파일럿'] }, '오토파일럿');
    expect(twice).toBeCloseTo(once, 5);
  });

  test('summary "완료" → "승인" boost', () => {
    expect(confOf({ ...baseCtx, lastTurnSummary: '작업 완료' }, '승인')).toBeGreaterThan(
      confOf(baseCtx, '승인'),
    );
  });

  test('every reason field is non-empty', () => {
    const out = rankIntents(baseCtx);
    for (const c of out) {
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  test('deterministic — same context → same ranking', () => {
    const a = rankIntents(baseCtx);
    const b = rankIntents(baseCtx);
    expect(a).toEqual(b);
  });
});

describe('buildRanking', () => {
  test('packages ranker output with version + clock', () => {
    const r = buildRanking(baseCtx, 7, 1_700_000_000_000);
    expect(r.sessionId).toBe('sess-1');
    expect(r.version).toBe(7);
    expect(r.generatedAt).toBe(1_700_000_000_000);
    expect(r.candidates).toHaveLength(6);
  });
});

describe('rankingsDiffer', () => {
  function ranking(version: number, top: string, conf: number): IntentRanking {
    return {
      sessionId: 'sess',
      version,
      generatedAt: 0,
      candidates: INTENT_BUTTON_LABELS.map((label) => ({
        label,
        confidence: label === top ? conf : 0.10,
        reason: '',
      })),
    };
  }

  test('null prev → always differs', () => {
    expect(rankingsDiffer(null, ranking(1, '승인', 0.9).candidates)).toBe(true);
  });

  test('identical candidates → no diff', () => {
    const r = ranking(1, '승인', 0.9);
    expect(rankingsDiffer(r, r.candidates)).toBe(false);
  });

  test('top label change → diff', () => {
    const prev = ranking(1, '승인', 0.9);
    const next = ranking(1, '계속 진행', 0.8).candidates;
    expect(rankingsDiffer(prev, next)).toBe(true);
  });

  test('confidence delta < 0.05 → no diff (top label same)', () => {
    const prev = ranking(1, '승인', 0.90);
    const next = ranking(1, '승인', 0.92).candidates;
    expect(rankingsDiffer(prev, next)).toBe(false);
  });

  test('confidence delta ≥ 0.05 → diff', () => {
    const prev = ranking(1, '승인', 0.90);
    const next = ranking(1, '승인', 0.95).candidates;
    expect(rankingsDiffer(prev, next)).toBe(true);
  });
});
