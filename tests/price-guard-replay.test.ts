import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPriceGuardCycle, ingestPriceGuardSignals, type HoldingMeta, type QuoteResult } from '../scripts/price-guard-cycle.js';
import { priceObservationToSignal } from '../src/domains/price-guard-signal.js';
import { runGate1 } from '../src/domains/signal-gate1.js';
import { runGate2 } from '../src/domains/signal-gate2.js';
import { runRouter, type SendFn } from '../src/domains/signal-router.js';
import { SignalPool, type Signal } from '../src/domains/signal-pool.js';

type ReplayRecord = {
  id: string;
  timestamp: string;
  holdings: HoldingMeta[];
  quotes: Record<string, QuoteResult>;
  previousRegime: unknown;
  regime: unknown;
};

const fixture = JSON.parse(readFileSync(
  join(import.meta.dir, 'fixtures', 'price-guard-2026-07-13.json'),
  'utf8',
)) as { records: ReplayRecord[] };

test('replays the 2026-07-13 drawdowns into S4 market signals without network access', async () => {
  const replay = fixture.records.find(record => record.id === 'morning-drawdown-and-regime-transition');
  if (!replay) throw new Error('drawdown replay record is missing');

  const quoteCalls: string[] = [];
  const cycle = runPriceGuardCycle({
    quote: (symbol) => {
      quoteCalls.push(symbol);
      return replay.quotes[symbol] ?? null;
    },
    latestRegime: () => replay.regime as never,
    previousRegime: () => replay.previousRegime as never,
    now: () => replay.timestamp,
  }, replay.holdings, []);

  const signals = cycle.snapshots
    .map(priceObservationToSignal)
    .filter((signal): signal is Signal => signal !== null);
  const pool = new SignalPool({ path: ':memory:' });
  for (const signal of signals) pool.ingest(signal);
  await runGate1(pool, { now: Date.parse(replay.timestamp) });

  expect(quoteCalls.sort()).toEqual(['000660', '122630', 'KORU']);
  expect(cycle.errors).toEqual([]);
  expect(signals.map(signal => signal.asset).sort()).toEqual(['000660', '122630', 'KORU']);
  expect(signals.every(signal => signal.source === 'market')).toBe(true);
  expect(signals.find(signal => signal.asset === '000660')?.raw).toContain('[held]');
  expect(pool.listBySeverity('S4').map(signal => signal.asset).sort()).toEqual(['000660', '122630', 'KORU']);
});

test('routes the composite and multi-axis drawdown replay once, while keeping labels and control alerts stable', async () => {
  const drawdown = fixture.records.find(record => record.id === 'morning-drawdown-and-regime-transition');
  const control = fixture.records.find(record => record.id === 'control-below-threshold');
  if (!drawdown || !control) throw new Error('replay records are missing');

  const replayCycle = (record: ReplayRecord) => runPriceGuardCycle({
    quote: symbol => record.quotes[symbol] ?? null,
    latestRegime: () => record.regime as never,
    previousRegime: () => record.previousRegime as never,
    now: () => record.timestamp,
  }, record.holdings, []);
  const toSignals = (record: ReplayRecord) => replayCycle(record).snapshots
    .map(priceObservationToSignal)
    .filter((signal): signal is Signal => signal !== null);

  const drawdownCycle = replayCycle(drawdown);
  const capstone = drawdownCycle.decisions
    .flatMap(decision => decision.triggers)
    .find(trigger => trigger.kind === 'CAPSTONE_WARNING');
  expect(drawdown.previousRegime).toMatchObject({ composite: 0.459, regimeLabel: 'RISK_ON' });
  expect(drawdown.regime).toMatchObject({ composite: 0.343, regimeLabel: 'RISK_ON', transitionAxes: ['community_buzz', 'dislocation'] });
  expect(capstone).toMatchObject({
    kind: 'CAPSTONE_WARNING',
    severity: 'warning',
    action: 'HOLD_AND_REVIEW',
    severityReason: 'composite fell 0.116 with 2 sign-flip axes',
  });

  const controlPool = new SignalPool({ path: ':memory:' });
  for (const signal of toSignals(control)) controlPool.ingest(signal);
  await runGate1(controlPool, { now: Date.parse(control.timestamp) });
  await runGate2(controlPool, { now: () => control.timestamp, classify: async () => ({ confirmed: true, recommendation: 'alert', relatedSectors: [], reason: 'unexpected' }) });
  const telegram: string[] = [];
  const telegramSpy: SendFn = (text, kind) => {
    telegram.push(`${kind}:${text}`);
    return true;
  };
  expect(runRouter(controlPool, { now: () => control.timestamp, send: telegramSpy })).toMatchObject({ total: 0, interrupt: 0, digDeferred: 0, sent: 0 });
  expect(telegram).toEqual([]);

  const pool = new SignalPool({ path: ':memory:' });
  const signals = toSignals(drawdown);
  for (const signal of signals) pool.ingest(signal);
  await runGate1(pool, { now: Date.parse(drawdown.timestamp) });
  await runGate2(pool, {
    now: () => drawdown.timestamp,
    classify: async () => ({ confirmed: true, recommendation: 'alert', relatedSectors: [], reason: 'replay protection event' }),
  });
  const routed = runRouter(pool, { now: () => drawdown.timestamp, send: telegramSpy });
  expect(routed).toMatchObject({ mode: 'live', total: 3, interrupt: 0, digDeferred: 3, batch: 0, sent: 0 });
  expect(routed.items).toHaveLength(3);
  expect(routed.items.every(item => item.eventId.startsWith('price-guard:'))).toBe(true);
  expect(routed.items.every(item => item.preview === '[deferred] 디깅 전 유보')).toBe(true);
  expect(telegram).toEqual([]);

  for (const signal of toSignals(drawdown)) expect(pool.ingest(signal)).toEqual({ inserted: false });
  await runGate1(pool, { now: Date.parse(drawdown.timestamp) });
  await runGate2(pool, { now: () => drawdown.timestamp, classify: async () => ({ confirmed: true, recommendation: 'alert', relatedSectors: [], reason: 'duplicate' }) });
  expect(runRouter(pool, { now: () => drawdown.timestamp, send: telegramSpy })).toMatchObject({ total: 3, interrupt: 0, digDeferred: 3, sent: 0 });
  expect(telegram).toEqual([]);
});

// ★ 크론 배선 수습(대표 2026-07-13) — ingestPriceGuardSignals 가 스냅샷을 Signal 로 도출해 pool 에
//   인입하는지(프로덕션 크론의 dead-code 갭 수습). 급락 리플레이=인입 발생, control=인입 0.
test('ingestPriceGuardSignals: 급락 리플레이는 critical 신호를 pool 에 인입(크론 배선 수습)', () => {
  const drawdown = fixture.records.find(r => r.id === 'morning-drawdown-and-regime-transition')!;
  const result = runPriceGuardCycle({
    quote: s => drawdown.quotes[s] ?? null,
    latestRegime: () => drawdown.regime as never,
    previousRegime: () => drawdown.previousRegime as never,
    now: () => drawdown.timestamp,
  }, drawdown.holdings, []);
  const pool = new SignalPool({ path: ':memory:' });
  const wired = ingestPriceGuardSignals(result, pool);
  expect(wired.signals).toBeGreaterThan(0);          // 어댑터가 critical 신호 도출
  expect(wired.ingested).toBe(wired.signals);        // pool 에 실제 인입(gate1→S4 는 downstream 크론)
});

test('ingestPriceGuardSignals: control(benign)은 인입 0(스팸 방지)', () => {
  const control = fixture.records.find(r => r.id === 'control-below-threshold')!;
  const result = runPriceGuardCycle({
    quote: s => control.quotes[s] ?? null,
    latestRegime: () => control.regime as never,
    previousRegime: () => control.previousRegime as never,
    now: () => control.timestamp,
  }, control.holdings, []);
  const pool = new SignalPool({ path: ':memory:' });
  const wired = ingestPriceGuardSignals(result, pool);
  expect(wired.signals).toBe(0);   // benign → critical 트리거 없음 → 신호 0
  expect(wired.ingested).toBe(0);
});
