#!/usr/bin/env bun
// A2.2b — 13F money-movement report + knowledge.db persistence.
//
// Fetches notable funds' latest 2 quarters of 13F (SEC EDGAR direct),
// persists holdings to ~/.elanous/knowledge_13f.db (fact_13f_holdings), and
// aggregates cross-fund QoQ moves into a brief report. Run:
//   bun run scripts/money-movement-report.ts

import { Database } from 'bun:sqlite';
import { knowledge13fDbPath } from '../src/domains/sec-13f.js';
import { resolveFundCik, fetch13F, type Filing13F } from '../src/domains/sec-13f.js';

const FUNDS = [
  'berkshire hathaway', 'bridgewater', 'scion asset', 'ark investment',
  'pershing square', 'appaloosa', 'third point', 'tiger global',
  'coatue', 'duquesne',
];

const DB = knowledge13fDbPath(); // M0.1: 13F DB(구 ~/.elanous/knowledge.db) 분리
const db = new Database(DB);
db.run(`CREATE TABLE IF NOT EXISTS fact_13f_holdings (
  cik TEXT, fund TEXT, period TEXT, filed TEXT, issuer TEXT, cusip TEXT,
  value REAL, shares REAL, PRIMARY KEY(cik, period, cusip, issuer));`);
const ins = db.prepare(`INSERT OR REPLACE INTO fact_13f_holdings
  (cik,fund,period,filed,issuer,cusip,value,shares) VALUES (?,?,?,?,?,?,?,?)`);

// Key by CUSIP (canonical security id) — funds spell issuer names
// differently ("CHEVRON CORPORATION" vs "CHEVRON CORP NEW"). First 8 chars
// = issuer+issue; drop the check digit. Track a representative name.
const cusipKey = (c: string) => (c || '').replace(/\s/g, '').slice(0, 8).toUpperCase();
const NAME = new Map<string, string>();
const byIssuer = (f: Filing13F) => {
  const m = new Map<string, number>();
  for (const h of f.holdings) {
    const k = cusipKey(h.cusip) || h.issuer;
    m.set(k, (m.get(k) ?? 0) + h.value);
    if (!NAME.has(k)) NAME.set(k, h.issuer);
  }
  return m;
};
const nm = (k: string) => NAME.get(k) ?? k;
const usd = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Move { fund: string; issuer: string; delta: number; kind: 'new' | 'exit' | 'up' | 'down'; }
const allMoves: Move[] = [];
const periods = new Set<string>();
let ok = 0;

for (const q of FUNDS) {
  try {
    const fund = await resolveFundCik(q);
    const filings = await fetch13F(fund.cik, 2);
    if (!filings.length) { console.error(`  skip ${q}: no 13F`); continue; }
    // persist
    for (const f of filings) for (const h of f.holdings)
      ins.run(fund.cik, fund.name, f.period, f.filed, h.issuer, h.cusip, h.value, h.shares);
    ok++;
    const [latest, prev] = filings;
    periods.add(latest.period);
    if (!prev) continue;
    const lv = byIssuer(latest), pv = byIssuer(prev);
    const total = [...lv.values()].reduce((a, b) => a + b, 0);
    for (const [k, v] of lv) {
      if (!pv.has(k)) allMoves.push({ fund: fund.name, issuer: k, delta: v, kind: 'new' });
      else if (Math.abs(v - pv.get(k)!) > total * 0.02) allMoves.push({ fund: fund.name, issuer: k, delta: v - pv.get(k)!, kind: v > pv.get(k)! ? 'up' : 'down' });
    }
    for (const [k, v] of pv) if (!lv.has(k)) allMoves.push({ fund: fund.name, issuer: k, delta: -v, kind: 'exit' });
    console.error(`  ✓ ${fund.name} (${latest.period})`);
    await sleep(400); // be gentle to SEC
  } catch (e) { console.error(`  skip ${q}: ${e instanceof Error ? e.message.slice(0, 60) : e}`); }
}

// Cross-fund aggregation
const agg = new Map<string, { net: number; buyers: Set<string>; sellers: Set<string> }>();
for (const m of allMoves) {
  const a = agg.get(m.issuer) ?? { net: 0, buyers: new Set(), sellers: new Set() };
  a.net += m.delta;
  (m.delta > 0 ? a.buyers : a.sellers).add(m.fund);
  agg.set(m.issuer, a);
}
const ranked = [...agg.entries()];
const topBuys = ranked.filter(([, a]) => a.net > 0).sort((a, b) => b[1].net - a[1].net).slice(0, 8);
const topSells = ranked.filter(([, a]) => a.net < 0).sort((a, b) => a[1].net - b[1].net).slice(0, 8);
const consensus = ranked.filter(([, a]) => a.buyers.size >= 2).sort((a, b) => b[1].buyers.size - a[1].buyers.size).slice(0, 6);

console.log(`\n# 💰 13F 머니무브먼트 리포트 (${ok}개 펀드 · 최신 분기 ${[...periods].sort().join('/')})`);
console.log(`\n## 🟢 순매수 상위 (펀드 합산 delta · CUSIP 기준)`);
for (const [k, a] of topBuys) console.log(`- ${nm(k)}: +${usd(a.net)} (매수 ${a.buyers.size}곳)`);
console.log(`\n## 🔴 순매도 상위`);
for (const [k, a] of topSells) console.log(`- ${nm(k)}: ${usd(a.net)} (매도 ${a.sellers.size}곳)`);
console.log(`\n## 🤝 컨센서스 매수 (2곳+ 동시 매수)`);
for (const [k, a] of consensus) console.log(`- ${nm(k)}: ${a.buyers.size}개 펀드 (${[...a.buyers].map(f => f.split(' ')[0]).join(', ')})`);
console.log(`\n(SEC EDGAR 13F-HR · 45일 지연 · 적재: ${DB})`);
db.close();
