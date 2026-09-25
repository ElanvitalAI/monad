// finance-cli(monad finance sector-flow) 회귀 — 격리 임시 screener.db fixture.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dbPath: string; let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fin-cli-'));
  dbPath = join(dir, 'screener.db');
  const db = new Database(dbPath);
  db.run('CREATE TABLE prices(date TEXT, code TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(date,code))');
  const ins = db.prepare('INSERT INTO prices(date,code,close) VALUES(?,?,?)');
  // 반도체(005930/000660/000990) 2 거래일 — 전부 +10% (daily window)
  for (const [d, px] of [['2026-07-06', 100], ['2026-07-07', 110]] as const) {
    for (const c of ['005930', '000660', '000990']) ins.run(d, c, px);
  }
  db.close();
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('computeSectorFlow: now=최신일 defaulting + 실측 수익률(반도체 +10%)', async () => {
  const { computeSectorFlow, renderSectorFlow } = await import('./finance-cli.js');
  const r = computeSectorFlow({ window: 'daily', granularity: 'category', dbPath });
  expect(r.asOf).toBe('2026-07-07'); // 캘린더 오늘 아닌 데이터 최신일
  const semi = r.sectors.find(s => s.chain === '반도체');
  expect(semi).toBeDefined();
  expect(Math.round(semi!.mom)).toBe(10);   // 100→110
  expect(semi!.breadth).toBe(100);          // 3/3 상승
  expect(renderSectorFlow(r)).toContain('반도체');
});

test('computeSectorFlow: 빈 DB → 빈 결과(throw 안 함)', async () => {
  const { computeSectorFlow } = await import('./finance-cli.js');
  const empty = mkdtempSync(join(tmpdir(), 'fin-empty-'));
  const p = join(empty, 'e.db');
  const db = new Database(p);
  db.run('CREATE TABLE prices(date TEXT, code TEXT, close REAL, PRIMARY KEY(date,code))');
  db.close();
  const r = computeSectorFlow({ dbPath: p });
  expect(r.sectors).toEqual([]);
  rmSync(empty, { recursive: true, force: true });
});
