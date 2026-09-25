#!/usr/bin/env bun
// ── 백테스팅 가격 히스토리 백필 (2026-07-08) ──────────────────────────────
//
// 백테스팅 루프 유니버스(KR_CHAINS + US 펄스)의 과거 2년 가격을 omni-market
// eod 로 받아 screener.db(prices)·us_pulse.db(bars)에 적재. 현 DB는 ~20일치라
// 백테스트(60일 최소·252 룩백) 불가 → tested=0. 이 백필로 커버리지 확대.
//
// 사용: bun scripts/backtest-backfill.ts [--market kr|us|all] [--limit N] [--from -2y]
// INSERT OR IGNORE(멱등·기존 행 보존). 크론 점진 백필 가능(일 N종목).

import { execFileSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { KR_CHAINS } from '../src/domains/sector-attractiveness.js';
import { loadUniverse, US_PULSE_DB } from '../src/domains/us-pulse.js';
import { SCREENER_DB_PATH } from '../src/domains/sector-store.js';

const OMNI = join(homedir(), '.claude/skills/omni-market/scripts/main.ts');
const OMNI_CWD = join(homedir(), '.claude/skills/omni-market');

const arg = (flag: string, def: string): string => { const i = process.argv.indexOf(flag); return i >= 0 ? String(process.argv[i + 1]) : def; };
const market = arg('--market', 'all');
const limit = Number(arg('--limit', '99999'));
const from = arg('--from', '-2y');

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

/** omni-market eod → 바 배열. 실패 시 빈 배열(fail-soft). */
function eod(symbol: string): Bar[] {
  try {
    const out = execFileSync('npx', ['tsx', OMNI, 'eod', symbol, '--from', from, '--json'],
      { cwd: OMNI_CWD, encoding: 'utf-8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const rows = JSON.parse(m[0]) as any[];
    return rows.filter(r => r && r.date && Number.isFinite(r.close));
  } catch { return []; }
}

function backfillKr(): void {
  const codes = [...new Set(Object.values(KR_CHAINS).flatMap(sub => Object.values(sub).flat()))].slice(0, limit);
  const db = new Database(SCREENER_DB_PATH);
  db.run(`CREATE TABLE IF NOT EXISTS prices(date TEXT, code TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(date,code))`);
  const ins = db.prepare(`INSERT OR IGNORE INTO prices(date,code,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)`);
  let done = 0, rows = 0, hit = 0;
  for (const code of codes) {
    const bars = eod(`${code}.KO`);
    if (bars.length) { hit++; const tx = db.transaction(() => { for (const b of bars) { ins.run(b.date, code, b.open ?? b.close, b.high ?? b.close, b.low ?? b.close, b.close, b.volume ?? 0); rows++; } }); tx(); }
    if (++done % 20 === 0) console.log(`KR ${done}/${codes.length} · hit ${hit} · rows ${rows}`);
  }
  db.close();
  console.log(`KR 백필 완료: ${done}종목 · 가격있음 ${hit} · ${rows}행`);
}

function backfillUs(): void {
  if (!existsSync(US_PULSE_DB)) { console.log('us_pulse.db 없음 — US 백필 스킵'); return; }
  const syms = loadUniverse().stocks.slice(0, limit);
  const db = new Database(US_PULSE_DB);
  db.run(`CREATE TABLE IF NOT EXISTS bars(symbol TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL, volume REAL, PRIMARY KEY(symbol,date))`);
  const ins = db.prepare(`INSERT OR IGNORE INTO bars(symbol,date,close,volume) VALUES (?,?,?,?)`);
  let done = 0, rows = 0, hit = 0;
  for (const sym of syms) {
    const bars = eod(`${sym}.US`);
    if (bars.length) { hit++; const tx = db.transaction(() => { for (const b of bars) { ins.run(sym, b.date, b.close, b.volume ?? 0); rows++; } }); tx(); }
    if (++done % 20 === 0) console.log(`US ${done}/${syms.length} · hit ${hit} · rows ${rows}`);
  }
  db.close();
  console.log(`US 백필 완료: ${done}종목 · 가격있음 ${hit} · ${rows}행`);
}

console.log(`백필 시작 — market=${market} limit=${limit} from=${from}`);
if (market === 'kr' || market === 'all') backfillKr();
if (market === 'us' || market === 'all') backfillUs();
console.log('백필 종료.');
