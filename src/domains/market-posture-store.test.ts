import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKET_POSTURE_SCHEMA_VERSION, type MarketPosture } from './market-posture.js';
import {
  DEFAULT_STALE_AFTER_MS,
  loadMarketPosture,
  publishMarketPosture,
  validateMarketPosture,
} from './market-posture-store.js';

function makePosture(overrides: Partial<MarketPosture> = {}): MarketPosture {
  return {
    schemaVersion: MARKET_POSTURE_SCHEMA_VERSION,
    asOf: '2026-07-14T00:00:00.000Z',
    defcon: 5,
    response: { cadenceMultiplier: 1, depth: 'rules', alertMode: 'batch', emergencySweep: false, gate2HitlRequired: false },
    provenance: { sources: ['regime', 'leverage'], calculatedBy: 'watch-loop' },
    freshness: { status: 'FRESH', observedAt: '2026-07-14T00:00:00.000Z', ageMs: 0 },
    regime: {
      composite: 0.42,
      label: 'NEUTRAL',
      transition: false,
      transitionAxes: [],
      asOf: '2026-07-14T00:00:00.000Z',
    },
    leverage: { regime: 'BULL_1_5X', effectiveExposure: 1.5 },
    ...overrides,
  };
}

describe('market-posture-store', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mp-store-'));
    path = join(dir, 'market-posture.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('publish then load round-trips the exact v2 contract', () => {
    const p = makePosture();
    const res = publishMarketPosture(p, { path });
    expect(res.ok).toBe(true);
    const loaded = loadMarketPosture({ path, now: new Date('2026-07-14T00:00:01.000Z') });
    expect(loaded).toEqual(p);
  });

  test('canonical sink is a single file path', () => {
    publishMarketPosture(makePosture(), { path });
    expect(existsSync(path)).toBe(true);
    // sidecar last-known-good is a derivative, not a second canonical read path.
    expect(existsSync(`${path}.last-good`)).toBe(true);
  });

  // ── version 검증 · malformed 거부 ──────────────────────────────────────
  test('rejects wrong schemaVersion on publish', () => {
    const bad = { ...makePosture(), schemaVersion: 'market-posture/v1' } as unknown as MarketPosture;
    const res = publishMarketPosture(bad, { path });
    expect(res.ok).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  test('rejects out-of-range and non-finite defcon', () => {
    for (const bad of [0, 6, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = { ...makePosture(), defcon: bad } as unknown as MarketPosture;
      expect(validateMarketPosture(p)).toBeNull();
    }
    for (const good of [1, 2, 3, 4, 5]) {
      const p = { ...makePosture(), defcon: good } as MarketPosture;
      expect(validateMarketPosture(p)).not.toBeNull();
    }
  });

  test('rejects malformed nested fields and bad enum/timestamp', () => {
    const cases: unknown[] = [
      { ...makePosture(), provenance: { sources: [1, 2], calculatedBy: 'x' } },
      { ...makePosture(), provenance: { sources: [], calculatedBy: '' } },
      { ...makePosture(), freshness: { status: 'WHATEVER', observedAt: '2026-07-14T00:00:00Z', ageMs: 0 } },
      { ...makePosture(), freshness: { status: 'FRESH', observedAt: 'not-a-date', ageMs: 0 } },
      { ...makePosture(), freshness: { status: 'FRESH', observedAt: '2026-07-14T00:00:00Z', ageMs: -1 } },
      { ...makePosture(), regime: { ...makePosture().regime, transition: 'yes' } },
      { ...makePosture(), regime: { ...makePosture().regime, composite: Number.NaN } },
      { ...makePosture(), leverage: { regime: 'X', effectiveExposure: Number.NaN } },
      null,
      42,
      [],
    ];
    for (const c of cases) {
      expect(validateMarketPosture(c)).toBeNull();
    }
  });

  // ── 부분 쓰기 / 잘못된 version 이 현재 정상 posture 를 훼손하지 않음 ──────
  test('rejected publish does not corrupt existing good posture', () => {
    const good = makePosture();
    publishMarketPosture(good, { path });
    const before = readFileSync(path, 'utf-8');

    const bad = { ...makePosture(), defcon: 99 } as unknown as MarketPosture;
    const res = publishMarketPosture(bad, { path });
    expect(res.ok).toBe(false);

    expect(readFileSync(path, 'utf-8')).toBe(before);
    expect(loadMarketPosture({ path, now: new Date('2026-07-14T00:00:01.000Z') })).toEqual(good);
  });

  // ── 손상 시 last-known-good 읽기 ──────────────────────────────────────
  test('corrupt canonical falls back to last-known-good', () => {
    const good = makePosture();
    publishMarketPosture(good, { path });
    // Simulate a torn/garbled canonical file.
    writeFileSync(path, '{ this is not valid json', 'utf-8');
    const loaded = loadMarketPosture({ path, now: new Date('2026-07-14T00:00:01.000Z') });
    expect(loaded).toEqual(good);
  });

  test('returns null when nothing valid exists', () => {
    expect(loadMarketPosture({ path })).toBeNull();
  });

  // ── stale 표시 ────────────────────────────────────────────────────────
  test('marks posture STALE when age exceeds threshold', () => {
    publishMarketPosture(makePosture(), { path });
    const now = new Date(Date.parse('2026-07-14T00:00:00.000Z') + DEFAULT_STALE_AFTER_MS + 1000);
    const loaded = loadMarketPosture({ path, now });
    expect(loaded?.freshness.status).toBe('STALE');
    expect(loaded?.freshness.ageMs).toBe(DEFAULT_STALE_AFTER_MS + 1000);
  });

  test('keeps FRESH when within threshold', () => {
    publishMarketPosture(makePosture(), { path });
    const now = new Date(Date.parse('2026-07-14T00:00:00.000Z') + 1000);
    const loaded = loadMarketPosture({ path, now });
    expect(loaded?.freshness.status).toBe('FRESH');
  });
});
