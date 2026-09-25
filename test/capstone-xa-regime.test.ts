// A 신호 원 설계 복원 + 통합 선제방어형 전환 (대표 지시 2026-07-07).
// A XA 규칙 = 백테스트 load_A_regime 정합 (equities_kr rank≥4 & z<-0.2).
// 운영 매핑 = 백테스트 build_nav_series t값(1/0/1/-1) 패리티.

import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcXaRegime, calcA } from '../src/domains/capstone-signals.js';
import { decideLeverage, DEFAULT_OPERATING_MODE } from '../src/domains/capstone-leverage.js';

function makeScores(dir: string, rows: Array<[string, string, number, number]>): string {
  const p = join(dir, 'scores.db');
  const db = new Database(p);
  db.run(`CREATE TABLE cross_asset_scores(preset_hash TEXT, as_of TEXT, asset_class TEXT, symbol TEXT, score REAL, z_score REAL, signal TEXT, rank INT)`);
  const ins = db.prepare(`INSERT INTO cross_asset_scores VALUES (?, ?, ?, 'X.US', 50, ?, 'HOLD', ?)`);
  for (const [hash, asOf, z, rank] of rows.map(r => [r[0], r[1], r[2], r[3]] as const)) {
    ins.run(hash, asOf, 'equities_kr', z, rank);
  }
  db.close();
  return p;
}

describe('calcXaRegime — 백테스트 load_A_regime 정합', () => {
  test('bear: rank≥4 & z<-0.2 (한주식 랭킹 하위권 = 자금이탈)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xa-'));
    const p = makeScores(dir, [['h1', '2026-07-06', -0.5, 5]]);
    const r = calcXaRegime(p)!;
    expect(r.riskOff).toBe(true);
    expect(r.rank).toBe(5);
    expect(r.z).toBe(-0.5);
    rmSync(dir, { recursive: true, force: true });
  });

  test('경계: rank 상위 or z 미달이면 정상 · 복수 preset AVG(파이썬 groupby.mean 정합)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xa-'));
    // rank 2(상위) — z 낮아도 정상
    const p1 = makeScores(dir, [['h1', '2026-07-06', -0.5, 2]]);
    expect(calcXaRegime(p1)!.riskOff).toBe(false);
    rmSync(dir, { recursive: true, force: true });

    const dir2 = mkdtempSync(join(tmpdir(), 'xa-'));
    // preset 2개 평균: rank (3+7)/2=5 · z (-0.1+-0.5)/2=-0.3 → bear
    const p2 = makeScores(dir2, [['h1', '2026-07-06', -0.1, 3], ['h2', '2026-07-06', -0.5, 7]]);
    const r2 = calcXaRegime(p2)!;
    expect(r2.rank).toBe(5);
    expect(r2.riskOff).toBe(true);
    rmSync(dir2, { recursive: true, force: true });
  });

  test('DB 부재/행 부재 → null (KRW 프록시 폴백)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xa-'));
    expect(calcXaRegime(join(dir, 'no.db'))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('A 합성 = XA OR KRW (calcA 회귀 포함)', () => {
    const stable = Array(60).fill(1400);
    expect(calcA([...stable, 1400])).toBe(false);
    expect(calcA([...stable.slice(1), 1450])).toBe(true);
    const src = require('node:fs').readFileSync('src/domains/capstone-signals.ts', 'utf-8');
    expect(src).toContain('const a = aKrw || (aXa?.riskOff ?? false)');
  });
});

describe('통합 선제방어형 (기본 운영 모드 — 백테스트 t값 패리티)', () => {
  test('기본 모드 = preemptive (대표 결정 2026-07-07)', () => {
    expect(DEFAULT_OPERATING_MODE).toBe('preemptive');
  });

  test('매핑 = build_nav_series: Bull 1× · Bear현금 0× · R3 1× · PSD -1×', () => {
    // t[~bear]=1
    const bull = decideLeverage('LONG_100', false, false);
    expect(bull.targetExposure).toBe(1);
    expect(bull.weights).toEqual({ stock: 1, lev2x: 0, inverse2x: 0, cash: 0 });
    // t[bear & ~r3]=0 — 스마트현금
    const cash = decideLeverage('CASH_100', true, false);
    expect(cash.targetExposure).toBe(0);
    expect(cash.weights.cash).toBe(1);
    // t[bear & r3]=1 — 재진입
    const r3 = decideLeverage('LONG_100', true, true);
    expect(r3.targetExposure).toBe(1);
    expect(r3.weights.stock).toBe(1);
    // K≥2 → t=-1 — 인버스 헤지 (2×인버스 50%)
    const hedge = decideLeverage('HEDGE_1D', true, false);
    expect(hedge.targetExposure).toBe(-1);
    expect(hedge.effectiveExposure).toBe(-1);
    expect(hedge.weights.inverse2x).toBe(0.5);
    // 전 국면 검산: effective == target
    for (const p of [bull, cash, r3, hedge]) expect(p.effectiveExposure).toBe(p.targetExposure);
  });

  test("mode='lv' 는 §4.1 유지 (연구/비교용 회귀)", () => {
    expect(decideLeverage('LONG_100', false, false, 'lv').targetExposure).toBe(1.5);
    expect(decideLeverage('LONG_100', true, true, 'lv').targetExposure).toBe(1.75);
    expect(decideLeverage('CASH_100', true, false, 'lv').targetExposure).toBe(-0.25);
    expect(decideLeverage('HEDGE_1D', true, false, 'lv').targetExposure).toBe(-1.25);
  });
});
