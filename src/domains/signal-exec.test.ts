// 신호 집행 단위테스트 — 순수(주입 mandate/시세/seam·paper 시뮬·멱등·집행0). A5.
import { test, expect, describe } from 'bun:test';
import { SignalPool, type Signal } from './signal-pool.js';
import { DEFAULT_MANDATE, type TradeMandate } from './trade-mandate.js';
import type { MarketSessions } from './finance.js';
import { resolveExecMode, sizeIntent, runExec, type ExecGateCtx } from './signal-exec.js';

const NOW = '2026-07-11T12:00:00Z';
const nowFn = () => NOW;

const KR_OPEN: MarketSessions = {
  kr: 'OPEN', us: 'CLOSED', krLive: true, usLive: false, usOvernight: false,
  krTradeable: true, anyTradeable: true, krHoliday: false, usHoliday: false, kstLabel: '', etLabel: '',
};
const gateCtx: ExecGateCtx = { regime: { regimeLabel: 'RISK_ON' }, sessions: KR_OPEN, now: Date.parse(NOW) };
const armed = (over: Partial<TradeMandate> = {}): TradeMandate => ({ ...DEFAULT_MANDATE, armed: true, live: false, ...over });

/** confirmed adjust 신호 seed(ingest + markGate2). */
function seedAdjust(p: SignalPool, over: Partial<Signal> = {}): void {
  const s: Signal = {
    eventId: 'e1', source: 'disclosure', asset: '005930.KO',
    observedAt: '2026-07-11T11:00:00Z', collectedAt: '2026-07-11T11:00:01Z',
    origin: 'Reuters', trust: 0.9, severity: 'S3', raw: '삼성 방어 축소 권고',
    recommendation: 'adjust', gate2At: '2026-07-11T11:55:00Z', ...over,
  };
  p.ingest(s);
  p.markGate2(s.eventId, { confirmed: true, recommendation: s.recommendation!, reason: s.raw, at: s.gate2At! });
}

describe('resolveExecMode', () => {
  test('disarmed → paper', () => expect(resolveExecMode(DEFAULT_MANDATE)).toBe('paper'));
  test('armed + !live → paper', () => expect(resolveExecMode(armed({ live: false }))).toBe('paper'));
  test('armed + live → live', () => expect(resolveExecMode(armed({ live: true }))).toBe('live'));
});

describe('sizeIntent', () => {
  test('명목/시세 → 정수 수량', () => {
    const f = sizeIntent('005930.KO', 'sell', 70_000, 1_000_000);
    expect(f?.qty).toBe(14);                  // floor(1,000,000/70,000)
    expect(f?.notionalKrw).toBe(14 * 70_000);
  });
  test('시세 없음 → null', () => expect(sizeIntent('X', 'buy', null, 1_000_000)).toBeNull());
  test('수량 0(고가) → null', () => expect(sizeIntent('X', 'buy', 2_000_000, 1_000_000)).toBeNull());
});

describe('runExec — listPendingExec 필터', () => {
  test('adjust 아닌 확정은 집행 대상 아님', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a', recommendation: 'alert' });  // adjust 아님
      seedAdjust(p, { eventId: 'b', recommendation: 'watch' });
      const r = await runExec(p, { mandate: armed(), gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r.processed).toBe(0);
    } finally { p.close(); }
  });
});

describe('runExec — paper(집행0·멱등)', () => {
  test('armed + 게이트 통과 → paper-filled + 멱등(재집행 안 함)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a' });   // 보호(축소) · trust 0.9 · RISK_ON
      const r = await runExec(p, { mandate: armed(), gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r.mode).toBe('paper');
      expect(r.filled).toBe(1);
      expect(r.items[0]!.status).toBe('paper-filled');
      expect(r.items[0]!.detail).toContain('PAPER sell');
      // 멱등 — 재실행 시 대상 0.
      const r2 = await runExec(p, { mandate: armed(), gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r2.processed).toBe(0);
    } finally { p.close(); }
  });

  test('disarmed → mandate 게이트 refused(집행0)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a' });
      const r = await runExec(p, { mandate: DEFAULT_MANDATE, gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r.filled).toBe(0);
      expect(r.refused).toBe(1);
      expect(r.items[0]!.status).toBe('refused');
      expect(r.items[0]!.detail).toContain('disarmed');
    } finally { p.close(); }
  });

  test('시세 없음 → 사이징 refused', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a' });
      const r = await runExec(p, { mandate: armed(), gateCtx, priceOf: () => null, now: nowFn });
      expect(r.refused).toBe(1);
      expect(r.items[0]!.detail).toContain('사이징 실패');
    } finally { p.close(); }
  });

  test('게이트 차단(stale) → blocked', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a', gate2At: '2026-07-11T05:00:00Z' }); // 7h 전 stale
      const r = await runExec(p, { mandate: armed(), gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r.items[0]!.status).toBe('blocked');
      expect(r.items[0]!.detail).toContain('freshness');
    } finally { p.close(); }
  });
});

describe('runExec — live(재-arm·seam)', () => {
  test('live 모드 + seam 미배선 → 무집행 refused(fail-closed)', async () => {
    const p = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(p, { eventId: 'a' });
      const r = await runExec(p, { mandate: armed({ live: true }), gateCtx, priceOf: () => 70_000, now: nowFn });
      expect(r.mode).toBe('live');
      expect(r.filled).toBe(0);
      expect(r.items[0]!.detail).toContain('seam 미배선');
    } finally { p.close(); }
  });

  test('live 모드 + seam 주입 → live-filled', async () => {
    const p = new SignalPool({ path: ':memory:' });
    const calls: string[] = [];
    const liveExec = async (fill: { symbol: string; qty: number }) => {
      calls.push(`${fill.symbol}:${fill.qty}`); return { ok: true, detail: 'orderId 123' };
    };
    try {
      seedAdjust(p, { eventId: 'a' });
      const r = await runExec(p, { mandate: armed({ live: true }), gateCtx, priceOf: () => 70_000, now: nowFn, liveExec });
      expect(r.filled).toBe(1);
      expect(r.items[0]!.status).toBe('live-filled');
      expect(calls.length).toBe(1);
    } finally { p.close(); }
  });
});
