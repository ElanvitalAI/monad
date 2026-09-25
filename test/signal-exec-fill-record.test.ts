import { describe, expect, test } from 'bun:test';
import { runExec, type ExecGateCtx } from '../src/domains/signal-exec.js';
import { parseExecFill } from '../src/domains/signal-outcome.js';
import { SignalPool, type Signal } from '../src/domains/signal-pool.js';
import { DEFAULT_MANDATE, type TradeMandate } from '../src/domains/trade-mandate.js';
import type { MarketSessions } from '../src/domains/finance.js';

const NOW = '2026-07-11T12:00:00Z';
const KR_OPEN: MarketSessions = {
  kr: 'OPEN', us: 'CLOSED', krLive: true, usLive: false, usOvernight: false,
  krTradeable: true, anyTradeable: true, krHoliday: false, usHoliday: false, kstLabel: '', etLabel: '',
};
const gateCtx: ExecGateCtx = { regime: { regimeLabel: 'RISK_ON' }, sessions: KR_OPEN, now: Date.parse(NOW) };
const armed = (over: Partial<TradeMandate> = {}): TradeMandate => ({ ...DEFAULT_MANDATE, armed: true, live: false, ...over });

function seedAdjust(pool: SignalPool): void {
  const signal: Signal = {
    eventId: 'fill-record', source: 'disclosure', asset: '005930.KO',
    observedAt: '2026-07-11T11:00:00Z', collectedAt: '2026-07-11T11:00:01Z',
    origin: 'test', trust: 0.9, severity: 'S3', raw: 'protect',
    recommendation: 'adjust', gate2At: '2026-07-11T11:55:00Z',
  };
  pool.ingest(signal);
  pool.markGate2(signal.eventId, { confirmed: true, recommendation: 'adjust', reason: signal.raw, at: signal.gate2At! });
}

describe('runExec live fill record', () => {
  test('successful live fill is parseable, labels sizing price, and preserves broker detail verbatim', async () => {
    const pool = new SignalPool({ path: ':memory:' });
    const brokerDetail = 'executed: 체결 정합 확인: verify_order_filled: OK — 3건 전부 FILLED…';
    try {
      seedAdjust(pool);
      const result = await runExec(pool, {
        mandate: armed({ live: true }), gateCtx, priceOf: () => 70_000, now: () => NOW,
        liveExec: async () => ({ ok: true, detail: brokerDetail }),
      });
      const item = result.items[0]!;
      expect(item.status).toBe('live-filled');
      expect(parseExecFill(item.detail)).toEqual({ side: 'sell', entryPrice: 70_000 });
      expect(item.detail).toContain('(intended sizing price; not actual execution price)');
      expect(item.detail.endsWith(brokerDetail)).toBe(true);
      expect(result).toMatchObject({ processed: 1, filled: 1, refused: 0 });
    } finally { pool.close(); }
  });

  test('paper fill detail remains unchanged', async () => {
    const pool = new SignalPool({ path: ':memory:' });
    try {
      seedAdjust(pool);
      const result = await runExec(pool, { mandate: armed(), gateCtx, priceOf: () => 70_000, now: () => NOW });
      expect(result.items[0]).toMatchObject({
        status: 'paper-filled',
        detail: 'PAPER sell 14 005930.KO @70000 (₩980000)',
      });
      expect(result).toMatchObject({ processed: 1, filled: 1, refused: 0 });
    } finally { pool.close(); }
  });

  test('failed live execution remains refused with broker detail and counters unchanged', async () => {
    const pool = new SignalPool({ path: ':memory:' });
    const brokerDetail = 'broker refused: market closed';
    try {
      seedAdjust(pool);
      const result = await runExec(pool, {
        mandate: armed({ live: true }), gateCtx, priceOf: () => 70_000, now: () => NOW,
        liveExec: async () => ({ ok: false, detail: brokerDetail }),
      });
      expect(result.items[0]).toMatchObject({ status: 'refused', detail: brokerDetail });
      expect(result).toMatchObject({ processed: 1, filled: 0, refused: 1 });
    } finally { pool.close(); }
  });
});
