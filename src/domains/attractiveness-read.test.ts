// 매력도 리더 단위테스트 — 순수(임시 scores.db·fail-soft). B2.
import { test, expect, describe, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAttractiveness } from './attractiveness-read.js';

const dir = mkdtempSync(join(tmpdir(), 'attr-'));
const dbPath = join(dir, 'scores.db');
{
  const db = new Database(dbPath);
  db.run(`CREATE TABLE scores(preset TEXT, symbol TEXT, as_of TEXT, total_score REAL, signal TEXT)`);
  const ins = db.prepare(`INSERT INTO scores(preset, symbol, as_of, total_score, signal) VALUES (?,?,?,?,?)`);
  ins.run('semis', '005930.KO', '2026-07-10', 55, 'HOLD');
  ins.run('semis', '005930.KO', '2026-07-11', 53.9, 'SELL');   // 최신
  ins.run('semis', '000660.KO', '2026-07-11', 50.8, 'HOLD');
  db.close();
}
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

describe('readAttractiveness', () => {
  test('최신 as_of 매력도 반환', () => {
    const v = readAttractiveness('005930.KO', { dbPath });
    expect(v?.signal).toBe('SELL');       // 07-11 최신(07-10 HOLD 아님)
    expect(v?.asOf).toBe('2026-07-11');
  });
  test('HOLD 종목', () => {
    expect(readAttractiveness('000660.KO', { dbPath })?.signal).toBe('HOLD');
  });
  test('미스코어 종목 → null(fail-soft)', () => {
    expect(readAttractiveness('KORU.US', { dbPath })).toBeNull();
  });
  test('DB 부재 → null(fail-soft·게이트 현행 유지)', () => {
    expect(readAttractiveness('005930.KO', { dbPath: '/nonexistent/scores.db' })).toBeNull();
  });
  test('구 스키마(z_score 컬럼 없음)도 견고 — z 없이 반환', () => {
    // 위 픽스처 DB 는 z_score 컬럼이 없다 → PRAGMA 감지로 NULL AS z. verdict 는 정상 반환·z 만 undefined.
    const v = readAttractiveness('005930.KO', { dbPath });
    expect(v?.signal).toBe('SELL');
    expect(v?.z).toBeUndefined();
  });
});

describe('readAttractiveness — z_score 컬럼 있는 스키마', () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'attrz-'));
  const dbPath2 = join(dir2, 'scores.db');
  {
    const db = new Database(dbPath2);
    db.run(`CREATE TABLE scores(preset TEXT, symbol TEXT, as_of TEXT, total_score REAL, z_score REAL, signal TEXT)`);
    db.prepare(`INSERT INTO scores(preset, symbol, as_of, total_score, z_score, signal) VALUES (?,?,?,?,?,?)`)
      .run('semis', '005930.KO', '2026-07-22', 72.1, 1.31, 'BUY');
    db.close();
  }
  afterAll(() => { try { rmSync(dir2, { recursive: true, force: true }); } catch { /* */ } });
  test('z_score 를 verdict.z 로 반환', () => {
    const v = readAttractiveness('005930.KO', { dbPath: dbPath2 });
    expect(v?.signal).toBe('BUY');
    expect(v?.z).toBe(1.31);
  });
});
