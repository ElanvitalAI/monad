import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRegimeDb, saveRegimeVector, latestRegimeVector, recentRegimeVectors, computeAndStoreRegime } from './regime-store.js';
import type { RegimeVector } from './regime-synth.js';

const dirs: string[] = [];
const tmpDb = (): string => { const d = mkdtempSync(join(tmpdir(), 'regime-')); dirs.push(d); return join(d, 'r.db'); };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const vec = (asOf: string, composite: number, label: RegimeVector['regimeLabel'], transition = false): RegimeVector =>
  ({ asOf, composite, regimeLabel: label, transition, transitionAxes: transition ? ['asset_flow', 'kr_flow'] : [],
     axes: [{ axis: 'kr_flow', direction: 1, strength: 0.5, confidence: 1, note: '' }] });

describe('regime-store — 국면 벡터 저장/조회', () => {
  test('save → latest 라운드트립', () => {
    const db = openRegimeDb(tmpDb());
    saveRegimeVector(db, vec('2026-07-07T00:00:00Z', 0.4, 'RISK_ON'));
    const got = latestRegimeVector(db);
    expect(got).toMatchObject({ composite: 0.4, regimeLabel: 'RISK_ON', transition: false });
    expect(got!.axes[0]?.axis).toBe('kr_flow'); // json 라운드트립
    db.close();
  });

  test('latest = 최신 as_of', () => {
    const db = openRegimeDb(tmpDb());
    saveRegimeVector(db, vec('2026-07-06T00:00:00Z', 0.2, 'NEUTRAL'));
    saveRegimeVector(db, vec('2026-07-07T00:00:00Z', -0.5, 'RISK_OFF', true));
    const got = latestRegimeVector(db)!;
    expect(got.asOf).toBe('2026-07-07T00:00:00Z');
    expect(got.transition).toBe(true);
    expect(got.transitionAxes).toEqual(['asset_flow', 'kr_flow']);
    db.close();
  });

  test('as_of PK 멱등(중복 저장 = 덮어쓰기)', () => {
    const db = openRegimeDb(tmpDb());
    saveRegimeVector(db, vec('2026-07-07T00:00:00Z', 0.2, 'NEUTRAL'));
    saveRegimeVector(db, vec('2026-07-07T00:00:00Z', 0.9, 'RISK_ON'));
    expect(recentRegimeVectors(db).length).toBe(1);
    expect(latestRegimeVector(db)!.composite).toBe(0.9);
    db.close();
  });

  test('빈 저장소 → latest null', () => {
    const db = openRegimeDb(tmpDb());
    expect(latestRegimeVector(db)).toBeNull();
    db.close();
  });

  test('computeAndStoreRegime — raw 주입 → 합성·저장 + prev 연결(transition)', async () => {
    const dbPath = tmpDb();
    // 1회차: 모든 축 risk-on
    const v1 = await computeAndStoreRegime('2026-07-07T00:00:00Z', {
      dbPath,
      raw: { krFlow: () => ({ netQtySum: 5e6, points: 10 }), krSector: () => ({ topMom: 2, foreignAligned: true, points: 5 }),
             krPulse: () => ({ avgChgPct: 2, points: 10 }) },
    });
    expect(v1.regimeLabel).toBe('RISK_ON');
    expect(v1.transition).toBe(false); // prev 없음
    // 2회차: 전부 risk-off → prev 대비 부호전환 → transition
    const v2 = await computeAndStoreRegime('2026-07-08T00:00:00Z', {
      dbPath,
      raw: { krFlow: () => ({ netQtySum: -5e6, points: 10 }), krSector: () => ({ topMom: -2, foreignAligned: true, points: 5 }),
             krPulse: () => ({ avgChgPct: -2, points: 10 }) },
    });
    expect(v2.regimeLabel).toBe('RISK_OFF');
    expect(v2.transition).toBe(true); // 3축 부호전환
    expect(v2.transitionAxes.length).toBeGreaterThanOrEqual(2);
  });
});
