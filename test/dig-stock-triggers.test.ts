// 눈에 띄는 종목 → 자동 디깅 트리거 (대표 지시 2026-07-06 — 적응 해상도).
// 기존 크론 산출물(us_pulse.db·screener.db) 재사용 검증 — fake DB 주입.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDigTables, enqueueStockTriggers } from '../src/domains/dig-engine.js';
import { openSignalsDb } from '../src/domains/breaking-signals.js';
import { openPulseDb } from '../src/domains/us-pulse.js';

let dir: string;
let digDb: Database;
let pulsePath: string;
let screenerPath: string;
const TODAY = new Date().toISOString().slice(0, 10);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dig-trig-'));
  digDb = openSignalsDb(join(dir, 'signals.db'));
  ensureDigTables(digDb);

  // US 펄스: PLTR 6일 연속↑ (강신호) · AAPL 2일 (미달)
  pulsePath = join(dir, 'us_pulse.db');
  const pdb = openPulseDb(pulsePath);
  const ins = pdb.prepare(`INSERT INTO bars(symbol, date, close, volume) VALUES (?,?,?,?)`);
  const days = ['2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'];
  [100, 102, 104, 107, 110, 114, 118].forEach((c, i) => ins.run('PLTR', days[i], c, 1e6));
  [200, 199, 201, 200, 199, 200, 201].forEach((c, i) => ins.run('AAPL', days[i], c, 1e6));
  pdb.close();

  // KR 스크리너: 당일 양호 급등 1건 + 수급 상위 1건
  screenerPath = join(dir, 'screener.db');
  const sdb = new Database(screenerPath);
  sdb.run(`CREATE TABLE screen(date TEXT, code TEXT, name TEXT, exchange TEXT, chg_pct REAL, volume REAL, value REAL, chain TEXT, subchain TEXT, n15 INT, n20 INT, nlimit INT, ncrash INT, dd_peak REAL, flag TEXT, screens TEXT, PRIMARY KEY(date, code))`);
  sdb.run(`CREATE TABLE investor(date TEXT, type TEXT, rank INT, name TEXT, price REAL, chg_pct REAL, net_qty REAL, PRIMARY KEY(date, type, rank))`);
  sdb.prepare(`INSERT INTO screen(date, code, name, chg_pct, flag) VALUES (?,?,?,?,?)`)
    .run(TODAY, '005930', '삼성전자', 18.5, '🟢양호');
  sdb.prepare(`INSERT INTO screen(date, code, name, chg_pct, flag) VALUES (?,?,?,?,?)`)
    .run(TODAY, '999999', '제외종목', 29.9, '🔴제외'); // flag 미달
  sdb.prepare(`INSERT INTO investor(date, type, rank, name, price, chg_pct, net_qty) VALUES (?,?,?,?,?,?,?)`)
    .run(TODAY, '외국인', 1, '한미반도체', 147000, 7.78, 50000);
  sdb.prepare(`INSERT INTO investor(date, type, rank, name, price, chg_pct, net_qty) VALUES (?,?,?,?,?,?,?)`)
    .run(TODAY, '기관', 1, 'SK스퀘어', 296000, 1.2, 30000); // 가격 동반 미달(<5%)
  sdb.close();
});

afterAll(() => { digDb.close(); rmSync(dir, { recursive: true, force: true }); });

describe('stock dig triggers (적응 해상도)', () => {
  test('US 강신호 + KR 스크리너/수급 → 큐 적재 · 기준 미달 제외 · 멱등', () => {
    const n1 = enqueueStockTriggers(digDb, { usPulseDbPath: pulsePath, screenerDbPath: screenerPath });
    const ids = (digDb.prepare(`SELECT id, topic, sector FROM dig_queue ORDER BY id`).all() as any[]);
    const idSet = ids.map(r => r.id);

    expect(idSet).toContain('pulse:US:PLTR:2026-07-03');           // 6일 연속↑
    expect(idSet.some(i => i.startsWith('pulse:US:AAPL'))).toBe(false); // 미달
    expect(idSet).toContain(`pulse:KR:005930:${TODAY}`);           // 양호 급등
    expect(idSet.some(i => i.includes('999999'))).toBe(false);     // 🔴제외 flag
    expect(idSet).toContain(`pulse:KR:flow:한미반도체:${TODAY}`);   // 수급+가격 동반
    expect(idSet.some(i => i.includes('SK스퀘어'))).toBe(false);    // 가격 동반 미달
    expect(n1).toBe(3);

    // 멱등 — 같은 날 재스캔 0건
    expect(enqueueStockTriggers(digDb, { usPulseDbPath: pulsePath, screenerDbPath: screenerPath })).toBe(0);

    // 토픽에 이유 요약 포함 (디깅 프롬프트 입력)
    const pltr = ids.find(r => r.id.startsWith('pulse:US:PLTR'));
    expect(pltr.topic).toContain('6일 연속 상승');
    expect(pltr.sector).toBe('PLTR'); // 쿨다운이 종목 단위로
  });

  test('소스 DB 부재 시 fail-soft 0건', () => {
    const fresh = openSignalsDb(join(dir, 'fresh.db'));
    ensureDigTables(fresh);
    expect(enqueueStockTriggers(fresh, { usPulseDbPath: join(dir, 'no.db'), screenerDbPath: join(dir, 'no2.db') })).toBe(0);
    fresh.close();
  });
});
