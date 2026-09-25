#!/usr/bin/env bun
// A2.2b sector rollup — 13F money movement by SECTOR (authoritative, not
// hand-rolled): issuer → ticker (SEC company_tickers) → GICS sector
// (omni-market fundamentals), cached in knowledge.db dim_security. Rolls
// up the cross-fund QoQ delta already persisted in fact_13f_holdings.
//   bun run scripts/13f-sector-rollup.ts

import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { knowledge13fDbPath, secUserAgent } from '../src/domains/sec-13f.js';
import { homedir } from 'node:os';

const HOME = homedir();
const DB = knowledge13fDbPath(); // M0.1: 13F DB 분리
const OMNI = join(HOME, '.claude/skills/omni-market/scripts/main.ts');
const UA = secUserAgent();
const db = new Database(DB);
db.run(`CREATE TABLE IF NOT EXISTS dim_security (cusip8 TEXT PRIMARY KEY, issuer TEXT, ticker TEXT, sector TEXT);`);

// 1. SEC company_tickers → normalized name → ticker index.
const norm = (s: string) => s.toUpperCase().replace(/[.,'\-]/g, ' ')
  .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|LLC|HOLDINGS?|HLDGS?|GROUP|THE|COM|CL\s*[A-C]|CLASS\s*[A-C]|N\s*V|SA|NEW|MTN|BE)\b/g, '')
  .replace(/\s+/g, ' ').trim();
const ct = JSON.parse(await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': UA } })).text());
const nameToTicker = new Map<string, string>();
for (const k of Object.keys(ct)) { const v = ct[k]; const n = norm(v.title); if (n && !nameToTicker.has(n)) nameToTicker.set(n, v.ticker); }

function sectorOf(ticker: string): string {
  try {
    const out = execFileSync('npx', ['tsx', OMNI, 'fundamentals', ticker],
      { cwd: join(HOME, '.claude/skills/omni-market'), encoding: 'utf-8', timeout: 40_000, maxBuffer: 4_000_000 });
    return /Sector:\*\*?\s*([A-Za-z /&]+?)\s*(\||\n)/.exec(out)?.[1]?.trim() || 'Unknown';
  } catch { return 'Unknown'; }
}

// 2. Cross-fund QoQ delta by cusip8 (latest vs prev per fund), from persisted holdings.
const rows = db.query(`SELECT cik, period, cusip, issuer, value FROM fact_13f_holdings`).all() as any[];
const perFund = new Map<string, { periods: string[]; byPeriod: Map<string, Map<string, { v: number; issuer: string }>> }>();
for (const r of rows) {
  const f = perFund.get(r.cik) ?? { periods: [], byPeriod: new Map() };
  const key = (r.cusip || '').replace(/\s/g, '').slice(0, 8).toUpperCase() || r.issuer;
  const pm = f.byPeriod.get(r.period) ?? new Map();
  const cur = pm.get(key) ?? { v: 0, issuer: r.issuer };
  pm.set(key, { v: cur.v + r.value, issuer: r.issuer }); f.byPeriod.set(r.period, pm);
  perFund.set(r.cik, f);
}
const netDelta = new Map<string, { net: number; issuer: string }>();
for (const [, f] of perFund) {
  const periods = [...f.byPeriod.keys()].sort();
  if (periods.length < 2) continue;
  const latest = f.byPeriod.get(periods[periods.length - 1])!, prev = f.byPeriod.get(periods[periods.length - 2])!;
  const keys = new Set([...latest.keys(), ...prev.keys()]);
  for (const k of keys) {
    const d = (latest.get(k)?.v ?? 0) - (prev.get(k)?.v ?? 0);
    const e = netDelta.get(k) ?? { net: 0, issuer: latest.get(k)?.issuer ?? prev.get(k)?.issuer ?? k };
    e.net += d; netDelta.set(k, e);
  }
}

// 3. Classify EVERY security, incrementally. dim_security is a persistent
// cache; each run resolves the still-uncached cusip8 (biggest movers first)
// up to a per-run cap, then the weekly cron converges to full coverage.
// No silent truncation — the remaining backlog is logged.
const CAP = Math.max(1, Number(process.argv[2] ?? 200) || 200); // classify budget / run
const cacheGet = db.prepare(`SELECT sector,ticker FROM dim_security WHERE cusip8=?`);
const cacheSet = db.prepare(`INSERT OR REPLACE INTO dim_security(cusip8,issuer,ticker,sector) VALUES(?,?,?,?)`);
const ordered = [...netDelta.entries()].sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net));
const uncached = ordered.filter(([c8]) => !cacheGet.get(c8));
const toClassify = uncached.slice(0, CAP);
console.error(`\n[classify] ${ordered.length} securities · ${ordered.length - uncached.length} cached · classifying ${toClassify.length} (cap ${CAP}) · ${uncached.length - toClassify.length} deferred`);
for (const [cusip8, { issuer }] of toClassify) {
  const tk = nameToTicker.get(norm(issuer)) ?? '';
  const sec = tk ? sectorOf(tk) : 'Unknown';
  cacheSet.run(cusip8, issuer, tk, sec);
  console.error(`  ${issuer.slice(0, 28)} → ${tk || '?'} → ${sec}`);
}
const deferred = uncached.length - toClassify.length;

// Roll up net delta by sector using the (now fuller) cache.
const bySector = new Map<string, { net: number; names: string[] }>();
for (const [cusip8, { net, issuer }] of ordered) {
  const c = cacheGet.get(cusip8) as any;
  const sec = (c?.sector && String(c.sector).trim()) || 'Unknown';
  const s = bySector.get(sec) ?? { net: 0, names: [] };
  s.net += net; if (Math.abs(net) > 5e8) s.names.push(`${issuer.slice(0, 20)}${net > 0 ? '▲' : '▼'}`);
  bySector.set(sec, s);
}

const usd = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);
const ranked = [...bySector.entries()].filter(([s]) => s !== 'Unknown').sort((a, b) => b[1].net - a[1].net);
console.log(`\n# 🏭 13F 섹터별 자금이동 (전종목 QoQ net · GICS via omni-market)`);
console.log(`\n## 🟢 순유입 섹터`);
for (const [s, d] of ranked.filter(([, d]) => d.net > 0)) console.log(`- ${s}: +${usd(d.net)}  ${d.names.slice(0, 4).join(' ')}`);
console.log(`\n## 🔴 순유출 섹터`);
for (const [s, d] of ranked.filter(([, d]) => d.net < 0).reverse()) console.log(`- ${s}: ${usd(d.net)}  ${d.names.slice(0, 4).join(' ')}`);
const nClassified = (db.query("SELECT count(*) c FROM dim_security WHERE trim(sector)!='' AND sector!='Unknown'").get() as any).c;
const nCached = (db.query('SELECT count(*) c FROM dim_security').get() as any).c;
console.log(`\n(캐시: dim_security · ${nClassified}/${ordered.length} 분류완료${deferred > 0 ? ` · ${deferred} 미분류 남음 (재실행 시 이어서)` : ' · 전종목 커버'} · dim rows ${nCached})`);
db.close();
