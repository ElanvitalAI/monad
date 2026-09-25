#!/usr/bin/env bun
// ── US 머니무브 펄스 러너 (2026-07-06 대표 지시) ────────────────────────
// --close    아침 결산: 벌크 EOD 적재 → 섹터 순환+눈에 띄는 종목+LLM 해석 → 발송
//            cron: 35 6 * * 2-6 (KST — US 마감 05/06시 후 · 휴장이면 자동 skip)
// --open30   개장+30분 스냅샷: 섹터 ETF 라이브 → 발송 (ET 09:50~10:25 게이트)
//            cron: 0 23 * * 1-5  +  0 0 * * 2-6 (DST/표준시 양쪽 — 게이트가 1개만 통과)
// --backfill N   과거 N거래일 벌크 적재 (첫 가동 시 스트릭/신고가 히스토리 확보)

import { buildClosePulse, buildOpenSnapshot, isOpen30Window, ingestDay, openPulseDb, loadUniverse, allSymbols } from '../src/domains/us-pulse.js';
import { fetchLiveQuote } from '../src/domains/capstone-signals.js';
import { marketSessions } from '../src/domains/finance.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { homedir } from 'node:os';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const mode = process.argv.includes('--open30') ? 'open30'
  : process.argv.includes('--backfill') ? 'backfill' : 'close';

function etMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = parts.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

if (mode === 'backfill') {
  const n = Number(process.argv[process.argv.indexOf('--backfill') + 1] ?? 15);
  const db = openPulseDb();
  const syms = allSymbols(loadUniverse());
  let ok = 0;
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; // 주말 skip
    const date = d.toISOString().slice(0, 10);
    const r = ingestDay(db, syms, undefined, date);
    if (r) { ok++; console.log(`${r.date}: ${r.added}건 적재`); }
  }
  db.close();
  console.log(`백필 완료: ${ok}세션`);
  process.exit(0);
}

if (mode === 'open30') {
  const s = marketSessions();
  if (!isOpen30Window(etMinutesNow(), s.us.startsWith('OPEN'))) {
    console.log(`개장+30 창 아님 (US=${s.us}) — skip`); // DST 반대쪽 크론이거나 휴장
    process.exit(0);
  }
  const msg = buildOpenSnapshot(fetchLiveQuote);
  if (!msg) { console.log('시세 확보 실패 — skip'); process.exit(0); }
  console.log(msg);
  if (!sendOutbound(msg, 'report')) { console.error('발송 실패'); process.exit(1); }
  process.exit(0);
}

// --close (기본): 아침 결산 (--force = 신규 세션 없어도 DB 최신일자로 재결산)
const r = await buildClosePulse(undefined, undefined, { force: process.argv.includes('--force') });
if (!r) { console.log('신규 US 세션 없음 (휴장/주말/이미 처리) — skip'); process.exit(0); }
console.log(r.report);
console.log(`\n[${r.date} · 포착 ${r.notable}종목 · 저장 ${r.savedPath ?? '실패'}]`);
if (!sendOutbound(r.report, 'report')) { console.error('발송 실패'); process.exit(1); }
