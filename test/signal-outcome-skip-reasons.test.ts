import { describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { runOutcomeCheck } from '../src/domains/signal-outcome.js';
import { SignalPool, type Signal } from '../src/domains/signal-pool.js';

const NOW = '2026-07-14T12:00:00Z';
const VALID_DETAIL = 'PAPER sell 3 005930.KO @286500 (₩859500)';

function seedExec(pool: SignalPool, eventId: string, options: { execAt?: string; detail?: string; asset?: string } = {}): void {
  const signal: Signal = {
    eventId,
    source: 'market',
    asset: options.asset ?? '005930.KO',
    observedAt: '2026-07-11T00:00:00Z',
    collectedAt: '2026-07-11T00:00:00Z',
    origin: 'test',
    trust: 0.9,
    raw: 'signal',
    recommendation: 'adjust',
    gate2At: '2026-07-11T01:00:00Z',
    confirmed: true,
  };
  pool.ingest(signal);
  pool.markGate2(eventId, { confirmed: true, recommendation: 'adjust', reason: 'test', at: signal.gate2At! });
  pool.markExec(eventId, {
    mode: 'paper',
    status: 'paper-filled',
    detail: options.detail ?? VALID_DETAIL,
    at: options.execAt ?? '2026-07-11T06:00:00Z',
  });
}

describe('runOutcomeCheck skip reasons', () => {
  test.each([
    ['invalid execution time', { execAt: 'not-an-iso-time' }, (): number | null => 280000, 'invalidExecutionTime'],
    ['pending horizon', { execAt: '2026-07-13T06:00:00Z' }, (): number | null => 280000, 'pendingHorizon'],
    ['unparseable fill detail', { detail: 'executed: verify_order_filled: OK' }, (): number | null => 280000, 'unparseableFillDetail'],
    ['missing price', { asset: 'MISSING.KO' }, (): number | null => null, 'missingPrice'],
  ] as const)('counts only %s for its isolated skip condition', (_name, options, priceOf, reason) => {
    const pool = new SignalPool({ path: ':memory:' });
    try {
      seedExec(pool, `isolated-${reason}`, options);
      const result = runOutcomeCheck(pool, { now: () => NOW, horizonDays: 3, priceOf });

      expect(result).toMatchObject({
        checked: 1,
        verified: 0,
        correct: 0,
        skipped: 1,
        invalidExecutionTime: reason === 'invalidExecutionTime' ? 1 : 0,
        pendingHorizon: reason === 'pendingHorizon' ? 1 : 0,
        unparseableFillDetail: reason === 'unparseableFillDetail' ? 1 : 0,
        missingPrice: reason === 'missingPrice' ? 1 : 0,
      });
      expect(result.skipped).toBe(
        result.invalidExecutionTime + result.pendingHorizon + result.unparseableFillDetail + result.missingPrice,
      );
    } finally {
      pool.close();
    }
  });

  test('keeps skipped equal to the sum for mixed skip reasons', () => {
    const pool = new SignalPool({ path: ':memory:' });
    try {
      seedExec(pool, 'mixed-invalid-exec-at', { execAt: 'not-an-iso-time' });
      seedExec(pool, 'mixed-pending-horizon', { execAt: '2026-07-13T06:00:00Z' });
      seedExec(pool, 'mixed-unparseable-fill', { detail: 'executed: verify_order_filled: OK' });
      seedExec(pool, 'mixed-missing-price', { asset: 'MISSING.KO' });
      const result = runOutcomeCheck(pool, {
        now: () => NOW,
        horizonDays: 3,
        priceOf: (asset) => asset === 'MISSING.KO' ? null : 280000,
      });

      expect(result.skipped).toBe(4);
      expect(result.skipped).toBe(
        result.invalidExecutionTime + result.pendingHorizon + result.unparseableFillDetail + result.missingPrice,
      );
    } finally {
      pool.close();
    }
  });

  test('preserves successful verification while all skip reasons remain zero', () => {
    const pool = new SignalPool({ path: ':memory:' });
    try {
      seedExec(pool, 'verified');
      const result = runOutcomeCheck(pool, { now: () => NOW, horizonDays: 3, priceOf: () => 280000 });

      expect(result).toMatchObject({
        checked: 1,
        verified: 1,
        correct: 1,
        skipped: 0,
        invalidExecutionTime: 0,
        pendingHorizon: 0,
        unparseableFillDetail: 0,
        missingPrice: 0,
      });
    } finally {
      pool.close();
    }
  });

  test('observes the eventId when a fill detail cannot be parsed', () => {
    const pool = new SignalPool({ path: ':memory:' });
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    const logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      events.push({ category, event, data });
    });
    try {
      seedExec(pool, 'unparseable-observation', { detail: 'executed: verify_order_filled: OK' });
      runOutcomeCheck(pool, { now: () => NOW, horizonDays: 3, priceOf: () => 280000 });

      expect(events).toContainEqual({
        category: 'signal.outcome',
        event: 'unparseable-fill-detail',
        data: { eventId: 'unparseable-observation', execDetail: 'executed: verify_order_filled: OK' },
      });
    } finally {
      logSpy.mockRestore();
      pool.close();
    }
  });
});
