// F1 (2026-05-12) — IntentRanking → OutboundEvent payload builder tests.

import { describe, expect, test } from 'bun:test';
import { buildOutboundEventFromRanking } from '../src/intent-prediction/outbound-payload.js';
import {
  INTENT_BUTTON_LABELS,
  type IntentCandidate,
  type IntentRanking,
} from '../src/intent-prediction/types.js';

function ranking(over: Partial<IntentRanking> = {}): IntentRanking {
  const candidates: IntentCandidate[] = INTENT_BUTTON_LABELS.map((label, i) => ({
    label,
    confidence: 0.5 - i * 0.05,
    reason: 'test',
  }));
  return {
    sessionId: 's1',
    candidates,
    version: 1,
    generatedAt: 1_700_000_000_000,
    ...over,
  };
}

describe('buildOutboundEventFromRanking · headline + body', () => {
  test('top confidence drives title; runner-up drives body', () => {
    const r = ranking({
      candidates: [
        { label: '계속 진행', confidence: 0.3, reason: '' },
        { label: '오토파일럿', confidence: 0.8, reason: '' },
        { label: '추가 보완', confidence: 0.6, reason: '' },
        { label: 'diff 보여줘', confidence: 0.2, reason: '' },
        { label: '승인', confidence: 0.1, reason: '' },
        { label: '잠시 멈춤', confidence: 0.05, reason: '' },
      ],
    });
    const ev = buildOutboundEventFromRanking(r);
    expect(ev.title).toBe('elanous · 오토파일럿');
    expect(ev.body).toBe('또는 추가 보완?');
  });

  test('body absent when only one candidate', () => {
    const r = ranking({
      candidates: [{ label: '계속 진행', confidence: 0.9, reason: '' }],
    });
    const ev = buildOutboundEventFromRanking(r);
    expect(ev.title).toBe('elanous · 계속 진행');
    expect(ev.body).toBeUndefined();
  });

  test('empty candidates → no-op event with placeholder title', () => {
    const r = ranking({ candidates: [] });
    const ev = buildOutboundEventFromRanking(r);
    expect(ev.title).toBe('elanous');
    expect(ev.body).toBeUndefined();
    const payload = ev.payload as { candidates: unknown[] };
    expect(payload.candidates).toEqual([]);
  });
});

describe('buildOutboundEventFromRanking · payload + id + ts', () => {
  test('id = `intent-<sessionId>-<version>`', () => {
    const ev = buildOutboundEventFromRanking(ranking({ sessionId: 'sess-x', version: 42 }));
    expect(ev.id).toBe('intent-sess-x-42');
  });

  test('ts defaults to ranking.generatedAt', () => {
    const ev = buildOutboundEventFromRanking(ranking({ generatedAt: 12345 }));
    expect(ev.ts).toBe(12345);
  });

  test('ts uses opts.now when provided', () => {
    const ev = buildOutboundEventFromRanking(ranking({ generatedAt: 12345 }), {
      now: () => 99999,
    });
    expect(ev.ts).toBe(99999);
  });

  test('payload.kind = intent-prediction · includes all 6 candidates sorted', () => {
    const ev = buildOutboundEventFromRanking(ranking());
    const payload = ev.payload as {
      kind: string;
      sessionId: string;
      version: number;
      candidates: { label: string; confidence: number }[];
    };
    expect(payload.kind).toBe('intent-prediction');
    expect(payload.sessionId).toBe('s1');
    expect(payload.version).toBe(1);
    expect(payload.candidates.length).toBe(6);
    // Confidence should be sorted desc.
    for (let i = 1; i < payload.candidates.length; i += 1) {
      expect(payload.candidates[i - 1]!.confidence)
        .toBeGreaterThanOrEqual(payload.candidates[i]!.confidence);
    }
  });

  test('payload candidates omit `reason` (telemetry / display only · not for push transport)', () => {
    const ev = buildOutboundEventFromRanking(ranking());
    const payload = ev.payload as { candidates: Record<string, unknown>[] };
    for (const c of payload.candidates) {
      expect(c.label).toBeDefined();
      expect(c.confidence).toBeDefined();
      expect(c.reason).toBeUndefined();
    }
  });
});

describe('buildOutboundEventFromRanking · opts overrides', () => {
  test('urgency defaults to normal · overridable', () => {
    expect(buildOutboundEventFromRanking(ranking()).urgency).toBe('normal');
    expect(buildOutboundEventFromRanking(ranking(), { urgency: 'high' }).urgency).toBe('high');
    expect(buildOutboundEventFromRanking(ranking(), { urgency: 'low' }).urgency).toBe('low');
    expect(buildOutboundEventFromRanking(ranking(), { urgency: 'critical' }).urgency).toBe('critical');
  });

  test('source defaults to thinker · overridable', () => {
    expect(buildOutboundEventFromRanking(ranking()).source).toBe('thinker');
    expect(buildOutboundEventFromRanking(ranking(), { source: 'patcher' }).source).toBe('patcher');
  });

  test('title override replaces the headline', () => {
    const ev = buildOutboundEventFromRanking(ranking(), { title: 'elanous nudge' });
    expect(ev.title).toBe('elanous nudge');
  });

  test('link present only when opts.link given', () => {
    expect(buildOutboundEventFromRanking(ranking()).link).toBeUndefined();
    expect(buildOutboundEventFromRanking(ranking(), { link: 'elanous://s/123' }).link)
      .toBe('elanous://s/123');
  });
});

describe('buildOutboundEventFromRanking · determinism', () => {
  test('byte-identical output for same input + opts', () => {
    const r = ranking();
    const a = buildOutboundEventFromRanking(r);
    const b = buildOutboundEventFromRanking(r);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('no Date.now() side effect (omits ts override → ranking.generatedAt is the only clock)', () => {
    // If the impl secretly called Date.now(), two back-to-back calls
    // 10ms apart would produce different ts. We assert they don't.
    const r = ranking({ generatedAt: 1 });
    const a = buildOutboundEventFromRanking(r);
    const b = buildOutboundEventFromRanking(r);
    expect(a.ts).toBe(b.ts);
    expect(a.ts).toBe(1);
  });
});
