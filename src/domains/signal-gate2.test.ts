// 2차 게이트 단위테스트 — 순수(주입 classifier·무네트워크). A2.
import { test, expect, describe } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import { parseGate2Response, runGate2, type Gate2Verdict } from './signal-gate2.js';

const sig = (over: Partial<Signal> = {}): Signal => ({
  eventId: 'e1', source: 'disclosure', observedAt: '2026-07-11T00:00:00Z',
  collectedAt: '2026-07-11T00:00:01Z', origin: 'Reuters', trust: 0.9, severity: 'S3', raw: 'SEC 제재', ...over,
});

describe('parseGate2Response', () => {
  test('유효 JSON', () => {
    const v = parseGate2Response('{"confirmed": true, "recommendation": "alert", "relatedSectors": ["반도체"], "reason": "실제 위협"}');
    expect(v?.confirmed).toBe(true);
    expect(v?.recommendation).toBe('alert');
    expect(v?.relatedSectors).toContain('반도체');
  });
  test('fence/prose 관대 + recommendation 폴백', () => {
    const v = parseGate2Response('```json\n{"confirmed": false, "recommendation": "이상값", "reason": "노이즈"}\n```');
    expect(v?.confirmed).toBe(false);
    expect(v?.recommendation).toBe('watch');   // 부정 값 → watch 폴백
  });
  test('파싱 실패 → null', () => {
    expect(parseGate2Response('no json here')).toBeNull();
  });
});

describe('listForGate2 — critical 미판정만', () => {
  test('S3/S4 미판정만 대상', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a', severity: 'S3' }));
      p.ingest(sig({ eventId: 'b', severity: 'S1' }));   // critical 아님
      p.ingest(sig({ eventId: 'c', severity: 'S4' }));
      const t = p.listForGate2();
      expect(t.map((s) => s.eventId).sort()).toEqual(['a', 'c']);
    } finally { p.close(); }
  });
});

describe('runGate2 — 주입 classifier', () => {
  test('confirmed/falsePositive 기록 + listConfirmed', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a', severity: 'S3', raw: '진짜' }));
      p.ingest(sig({ eventId: 'b', severity: 'S3', raw: '노이즈' }));
      const classify = async (s: Signal): Promise<Gate2Verdict> =>
        s.raw === '진짜'
          ? { confirmed: true, recommendation: 'alert', relatedSectors: ['반도체'], reason: '실위협' }
          : { confirmed: false, recommendation: 'watch', relatedSectors: [], reason: '오탐' };
      const r = await runGate2(p, { classify, now: () => '2026-07-11T00:00:05Z' });
      expect(r.judged).toBe(2);
      expect(r.confirmed).toBe(1);
      expect(r.falsePositive).toBe(1);
      const conf = p.listConfirmed();
      expect(conf.length).toBe(1);
      expect(conf[0]!.eventId).toBe('a');
      expect(conf[0]!.recommendation).toBe('alert');
      // 재실행 시 이미 판정된 것 제외.
      expect(p.listForGate2().length).toBe(0);
    } finally { p.close(); }
  });
  test('판정 실패 → fail-soft(watch·미확정)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      p.ingest(sig({ eventId: 'a', severity: 'S4' }));
      const r = await runGate2(p, { classify: async () => null, now: () => 't' });
      expect(r.confirmed).toBe(0);
      expect(r.falsePositive).toBe(1);   // 실패=미확정
    } finally { p.close(); }
  });
});
