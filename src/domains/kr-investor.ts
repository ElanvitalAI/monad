// ── KR 투자자 수급(외국인/기관) 일별 적재 복원 (2026-07-06 대표 지시) ────
//
// screener.db investor 테이블이 2026-06-11 부터 죽어 있던 근본원인: Conatus
// data.py 가 수집을 frgn-institution(마크다운)→investor_focus(ASCII 표)로
// 리팩토링했는데 db.py parse_investor 는 구형 마크다운만 파싱 → 조용히 0건.
// 해결: monad 소유 인제스트 — kr-flow `frgn-institution`(장중 가집계·장마감 후
// 확정치) 마크다운을 직접 파싱해 investor 스키마 그대로 적재.
// 소비자: dig-engine 종목 트리거(수급+가격 동반) · finance_backtest.

import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusPath } from './conatus-data-dir.js';

export const SCREENER_DB_PATH = conatusPath('screener.db');
const KRFLOW = join(homedir(), '.claude/skills/kr-flow/scripts/main.py');

export interface InvestorRow {
  date: string; type: '외국인' | '기관'; rank: number;
  name: string; price: number; chg_pct: number; net_qty: number;
}

const num = (s: string): number => Number(String(s).replace(/[,%\s]/g, '')) || 0;

/** kr-flow frgn-institution 마크다운 파싱 — "### 외국인/기관 순매수 상위" 섹션의
 *  `| 종목명 | 현재가 | 등락률(%) | 순매수(주) |` 행. Conatus parse_investor 와 호환. */
export function parseInvestorMarkdown(md: string, date: string): InvestorRow[] {
  const rows: InvestorRow[] = [];
  let typ: '외국인' | '기관' | null = null;
  let rank = 0;
  for (const line of md.split('\n')) {
    if (line.includes('외국인 순매수')) { typ = '외국인'; rank = 0; continue; }
    if (line.includes('기관 순매수')) { typ = '기관'; rank = 0; continue; }
    const t = line.trim();
    if (!typ || !t.startsWith('|') || t.includes('---') || t.includes('종목명')) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    if (cells.length < 4 || !cells[0]) continue;
    rank++;
    rows.push({ date, type: typ, rank, name: cells[0]!, price: num(cells[1]!), chg_pct: num(cells[2]!), net_qty: num(cells[3]!) });
  }
  return rows;
}

/** kr-flow CLI 호출 (KIS .env 스킬 자체 로드 — 데몬 env 무관·주입 금지 gotcha). */
export function fetchInvestorMarkdown(): string {
  return execFileSync('python3', [KRFLOW, 'frgn-institution'],
    { encoding: 'utf-8', timeout: 60_000, maxBuffer: 4_000_000 });
}

/** 오늘(KST) 수급 적재 — INSERT OR REPLACE 멱등. 적재 건수 반환. */
export function ingestInvestor(dbPath: string = SCREENER_DB_PATH, md?: string, date?: string): number {
  const kstToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const rows = parseInvestorMarkdown(md ?? fetchInvestorMarkdown(), date ?? kstToday);
  if (rows.length === 0) return 0;
  const db = new Database(dbPath);
  try {
    db.run(`CREATE TABLE IF NOT EXISTS investor(
      date TEXT, type TEXT, rank INT, name TEXT, price REAL, chg_pct REAL, net_qty REAL,
      PRIMARY KEY(date, type, rank))`);
    const ins = db.prepare(`INSERT OR REPLACE INTO investor VALUES(?,?,?,?,?,?,?)`);
    for (const r of rows) ins.run(r.date, r.type, r.rank, r.name, r.price, r.chg_pct, r.net_qty);
  } finally { db.close(); }
  return rows.length;
}
