// 반응형 렌즈 단위테스트 — 순수(주입 dig·무네트워크·멱등). B1.
import { test, expect, describe } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import { signalToDigItem, runReactiveLens } from './signal-dig.js';

const NOW = '2026-07-11T12:00:00Z';
const nowFn = () => NOW;

/** confirmed critical seed(ingest + markGate2). */
function seed(p: SignalPool, over: Partial<Signal> = {}): void {
  const s: Signal = {
    eventId: 'e1', source: 'disclosure', asset: '005930.KO',
    observedAt: '2026-07-11T11:00:00Z', collectedAt: '2026-07-11T11:00:01Z',
    origin: 'DART', trust: 0.9, severity: 'S4', raw: '삼성 대형 공시',
    recommendation: 'adjust', gate2At: NOW, ...over,
  };
  p.ingest(s);
  p.markGate2(s.eventId, { confirmed: s.confirmed ?? true, recommendation: s.recommendation ?? 'watch', reason: s.raw, at: s.gate2At! });
}

describe('signalToDigItem', () => {
  test('S4=score10·S3=score8·id/sector', () => {
    const s4 = signalToDigItem({ eventId: 'a', severity: 'S4', raw: 'x', asset: '005930.KO', source: 'disclosure' } as Signal);
    expect(s4.score).toBe(10);
    expect(s4.id).toBe('signal:pool:a');
    expect(s4.sector).toBe('005930.KO');
    const s3 = signalToDigItem({ eventId: 'b', severity: 'S3', raw: 'y', source: 'market' } as Signal);
    expect(s3.score).toBe(8);
    expect(s3.sector).toBe('market');   // asset 없으면 source
  });
});

describe('listPendingDig — S4/adjust·미디깅만', () => {
  test('S4 또는 adjust 만·이미 디깅 제외', () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seed(p, { eventId: 'a', severity: 'S4', recommendation: 'watch' });   // S4
      seed(p, { eventId: 'b', severity: 'S3', recommendation: 'adjust' });  // adjust
      seed(p, { eventId: 'c', severity: 'S3', recommendation: 'watch' });   // 대상 아님
      const pend = p.listPendingDig();
      expect(pend.map((s) => s.eventId).sort()).toEqual(['a', 'b']);
    } finally { p.close(); }
  });
});

describe('runReactiveLens', () => {
  test('디깅 verdict 환류(markDug) + 멱등', async () => {
    const p = new SignalPool({ path: ':memory:' });
    const dig = async () => ({ verdict: '파생·수급 교차: 실위협 확인', confidence: 'high' });
    try {
      seed(p, { eventId: 'a', severity: 'S4' });
      const r = await runReactiveLens(p, { dig, now: nowFn });
      expect(r.processed).toBe(1);
      expect(r.dug).toBe(1);
      const s = p.listConfirmed().find((x) => x.eventId === 'a')!;
      expect(s.digVerdict).toContain('실위협 확인');
      expect(s.digConfidence).toBe('high');
      // 멱등 — 재실행 시 대상 0.
      expect((await runReactiveLens(p, { dig, now: nowFn })).processed).toBe(0);
    } finally { p.close(); }
  });

  test('디깅 실패 → dug 마킹(재디깅 storm 방지)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    const dig = async () => null;
    try {
      seed(p, { eventId: 'a', severity: 'S4' });
      const r = await runReactiveLens(p, { dig, now: nowFn });
      expect(r.failed).toBe(1);
      expect(p.listPendingDig().length).toBe(0);   // 실패도 소진(재시도 안 함)
    } finally { p.close(); }
  });

  test('디깅 throw → fail-soft(다른 신호 계속)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    let n = 0;
    const dig = async () => { n += 1; if (n === 1) throw new Error('boom'); return { verdict: 'ok', confidence: 'medium' }; };
    try {
      seed(p, { eventId: 'a', severity: 'S4', gate2At: '2026-07-11T11:50:00Z' });
      seed(p, { eventId: 'b', severity: 'S4', gate2At: '2026-07-11T11:55:00Z' });
      const r = await runReactiveLens(p, { dig, now: nowFn });
      expect(r.processed).toBe(2);
      expect(r.dug + r.failed).toBe(2);   // 하나 throw·하나 성공
    } finally { p.close(); }
  });
});
