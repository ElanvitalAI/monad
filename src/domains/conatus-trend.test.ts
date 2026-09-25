// conatus-trend 회귀 — 격리 fixture(임시 CONATUS_DATA_DIR·python/네트워크 무의존).
// trend.py 읽기경로 흡수(신규/이탈 set-diff·연속 와칭 streak·외국인 연속순매수·trend_section)를
// 결정론 검증. 라이브 파리티(python↔TS 신호 byte-eq)는 scratchpad/conatus-parity 별도(격리 사본).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const prev = process.env.CONATUS_DATA_DIR;

// db.py 스키마 동형(screen 16컬럼·investor 7컬럼). 최소 컬럼만 채움(trend 는 date/code/name/flag/screens 만 읽음).
function buildDb(path: string, opts: { twoDates: boolean }): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }); // 재빌드(테스트별 격리)
  const db = new Database(path);
  db.run(`CREATE TABLE screen(
    date TEXT, code TEXT, name TEXT, exchange TEXT, chg_pct REAL, volume REAL, value REAL,
    chain TEXT, subchain TEXT, n15 INT, n20 INT, nlimit INT, ncrash INT, dd_peak REAL,
    flag TEXT, screens TEXT, PRIMARY KEY(date, code))`);
  db.run(`CREATE TABLE investor(
    date TEXT, type TEXT, rank INT, name TEXT, price REAL, chg_pct REAL, net_qty REAL,
    PRIMARY KEY(date, type, rank))`);
  const sc = db.prepare('INSERT INTO screen(date, code, name, flag, screens) VALUES(?,?,?,?,?)');
  // D1(2026-01-01) 와칭 = {A, B}. C 는 vol_top(비와칭) → 필터 제외 검증.
  sc.run('2026-01-01', '005930', '삼성전자', '🟢양호', 'mom_major,vol_top');
  sc.run('2026-01-01', '000660', 'SK하이닉스', null, 'kospi_10');
  sc.run('2026-01-01', '035420', '네이버', null, 'vol_top'); // 비와칭
  if (opts.twoDates) {
    // D2(2026-01-02) 와칭 = {A, D, E}. B 이탈. D=flag 있음, E=flag null(None 렌더 검증).
    sc.run('2026-01-02', '005930', '삼성전자', '🟢양호', 'mom_major');
    sc.run('2026-01-02', '005380', '현대차', '🟡주의', 'mom_candidate');
    sc.run('2026-01-02', '207940', '삼성바이오', null, 'kospi_10');
    sc.run('2026-01-02', '035420', '네이버', null, 'gain_top'); // 여전히 비와칭
  }
  const iv = db.prepare('INSERT INTO investor(date, type, rank, name) VALUES(?,?,?,?)');
  // 외국인: D1=[X,Y], D2=[X,Z] → last=D2. X streak 2, Z streak 1. 기관 행은 제외되어야.
  iv.run('2026-01-01', '외국인', 1, 'X전자');
  iv.run('2026-01-01', '외국인', 2, 'Y화학');
  iv.run('2026-01-01', '기관', 1, '무시기관'); // type 필터 검증
  if (opts.twoDates) {
    iv.run('2026-01-02', '외국인', 1, 'X전자');
    iv.run('2026-01-02', '외국인', 2, 'Z바이오');
    iv.run('2026-01-02', '기관', 1, '무시기관2');
  }
  db.close();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'conatus-trend-'));
  process.env.CONATUS_DATA_DIR = dir;
});
afterAll(() => {
  if (prev === undefined) delete process.env.CONATUS_DATA_DIR; else process.env.CONATUS_DATA_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('computeTrend: 와칭 필터·신규/이탈 set-diff·streak·외국인 streak', async () => {
  const { computeTrend } = await import('./conatus-trend.js');
  buildDb(join(dir, 'screener.db'), { twoDates: true });
  const tr = computeTrend()!;
  expect(tr).not.toBeNull();
  expect(tr.date).toBe('2026-01-02');
  expect(tr.prev).toBe('2026-01-01');

  // 신규 = D2 와칭 중 D1 에 없던 코드 = {현대차(D), 삼성바이오(E)}. 네이버는 비와칭이라 제외.
  const newCodes = tr.new.map(n => n.code).sort();
  expect(newCodes).toEqual(['005380', '207940']);
  const hyundai = tr.new.find(n => n.code === '005380')!;
  expect(hyundai.name).toBe('현대차');
  expect(hyundai.flag).toBe('🟡주의');
  expect(tr.new.find(n => n.code === '207940')!.flag).toBeNull(); // null flag

  // 이탈 = D1 와칭 중 D2 에 없는 코드 = {SK하이닉스(B)}. 네이버(비와칭)는 애초에 미포함.
  expect(tr.dropped.map(d => d.code)).toEqual(['000660']);
  expect(tr.dropped[0].name).toBe('SK하이닉스');

  // streak: 삼성전자(A) 이틀 연속=2, 현대차/삼성바이오 = 1. streak desc 정렬.
  const sMap = Object.fromEntries(tr.streak.map(s => [s.code, s.streak]));
  expect(sMap['005930']).toBe(2);
  expect(sMap['005380']).toBe(1);
  expect(sMap['207940']).toBe(1);
  expect(tr.streak[0].streak).toBe(2); // 최상단이 최장 streak

  // 외국인 연속순매수: X전자 2일(D1·D2 연속), Z바이오 1일. 기관/type 필터로 무시기관 제외.
  const fMap = Object.fromEntries(tr.foreignStreak.map(f => [f.name, f.streak]));
  expect(fMap['X전자']).toBe(2);
  expect(fMap['Z바이오']).toBe(1);
  expect(fMap['무시기관']).toBeUndefined();
  expect(fMap['Y화학']).toBeUndefined(); // last(D2)에 없으므로 미포함
});

test('renderTrendSection: trend_section 포맷(신규/이탈/연속와칭/외국인·None flag·>=2 임계)', async () => {
  const { computeTrend, renderTrendSection } = await import('./conatus-trend.js');
  buildDb(join(dir, 'screener.db'), { twoDates: true });
  const sec = renderTrendSection(computeTrend());
  expect(sec.startsWith('📅 일별 추세 (전일 대비)')).toBe(true);
  expect(sec).toContain('🆕 신규진입: ');
  expect(sec).toContain('현대차(🟡주의)');
  expect(sec).toContain('삼성바이오(None)'); // null flag → 파이썬 str(None)
  expect(sec).toContain('⬇️ 이탈: SK하이닉스');
  expect(sec).toContain('🔥 연속와칭: 삼성전자(2일)'); // >=2 만
  expect(sec).not.toContain('현대차(1일)'); // streak 1 은 연속와칭에서 제외
  expect(sec).toContain('🏦 외국인 연속순매수: X전자(2일)');
  expect(sec).not.toContain('Z바이오(1일)'); // >=2 만
});

test('render: 데이터<2일 → 헤더만 → fallback 문자열', async () => {
  const { computeTrend, render, renderTrendSection, TREND_FALLBACK } = await import('./conatus-trend.js');
  buildDb(join(dir, 'screener.db'), { twoDates: false }); // 단일 날짜
  const tr = computeTrend()!;
  expect(tr.prev).toBeNull();
  expect(tr.new).toEqual([]);
  expect(tr.dropped).toEqual([]);
  // 단일일: 모든 streak=1 → hot 없음, 외국인도 단일일이라 전부 1 → fs2 없음 → 섹션 헤더만.
  expect(renderTrendSection(tr)).toBe('');
  expect(render(tr)).toBe(TREND_FALLBACK);
});

test('computeTrend: DB 없으면 null → render fallback', async () => {
  const { computeTrend, render, TREND_FALLBACK } = await import('./conatus-trend.js');
  const missing = mkdtempSync(join(tmpdir(), 'conatus-trend-empty-'));
  const tr = computeTrend({ dbPath: join(missing, 'nope.db') });
  expect(tr).toBeNull();
  expect(render(tr)).toBe(TREND_FALLBACK);
  rmSync(missing, { recursive: true, force: true });
});
