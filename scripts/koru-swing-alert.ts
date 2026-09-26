#!/usr/bin/env bun
// ── KORU 550주 스윙 알림 (10분 크론) ──────────────────────────────────
// omni-market KORU 시세 조회 → 예약주문 세팅 가이드 / 스톱 조정 안내를 텔레그램
// 발송. 신규 이벤트(익절 도달·손절 액션·고가 유의미 갱신) 시에만 발송(스팸 방지).
// ★ READ-ONLY 안내 — 실시간 체결은 증권사 예약주문/스톱로스. elanous는 세팅 가이드만.
//
// cron 예시 (KORU 거래시간·KST): */10 9-16 평일 + */10 22,23,0-5 (미국장).

import { evaluateKoruSwing, formatOrderPlan, shouldAlert, markNotified } from '../src/domains/koru-trailing.js';
import { fetchTossQuote } from '../src/domains/toss-quote.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { marketSessions } from '../src/domains/finance.js';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const OMNI = join(HOME, '.claude/skills/omni-market/scripts/main.ts');

// 현재가 + 오늘 세션 고가(EODHD real-time `high`). 세션 고가를 highwater 에
// 먹여 10분 스냅샷이 놓치는 intraday 고점을 교정(트레일링 손절선 정확도). 장
// 마감이면 quote 는 마지막 세션 OHLC → high 는 지난 세션 고가라 running max 에
// 안전(내려가지 않음). 조회 실패면 null → 상위에서 skip.
function koruQuote(): { close: number; high: number } | null {
  try {
    const out = execFileSync('npx', ['tsx', OMNI, 'quote', 'KORU.US', '--json'],
      { cwd: join(HOME, '.claude/skills/omni-market'), encoding: 'utf-8', timeout: 45_000 });
    const m = /\{[\s\S]*?"close"[\s\S]*?\}/.exec(out);
    if (m) {
      const j = JSON.parse(m[0]) as { close?: unknown; high?: unknown };
      if (typeof j.close === 'number') {
        const high = Number(j.high);
        return { close: j.close, high: high > 0 ? high : j.close };
      }
    }
  } catch { /* fail-soft */ }
  return null;
}

// 토스 우선(전 US 세션 라이브: 정규·주간거래). 실패 시 EODHD. 마감이면 EODHD 종가.
const km = marketSessions();
let cur: number; let sessHigh: number; let refPrice: number | undefined; let src: string;
const t = (km.usLive || km.usOvernight) ? fetchTossQuote('KORU') : null;
if (t) { cur = t.last; sessHigh = t.high; refPrice = t.prevClose; src = km.usOvernight ? '토스주간' : '토스'; }
else {
  const q = koruQuote();
  if (q == null || !(q.close > 0)) { console.log('KORU 시세 조회 실패 — skip'); process.exit(0); }
  cur = q.close; sessHigh = q.high; src = 'EODHD';
}

const now = new Date().toISOString();
// 주간거래(Blue Ocean) 세션에서만 ±20% 리밋 적용.
const e = evaluateKoruSwing(cur, now, undefined, sessHigh, km.usOvernight ? refPrice : undefined);
console.log(`KORU $${cur} (${src}) · 세션고가 $${sessHigh} · highwater $${e.state.highwater}`);
if (!shouldAlert(e)) { console.log(`KORU $${cur} · 신규 이벤트 없음 — 발송 skip`); process.exit(0); }

const msg = formatOrderPlan(e);
console.log(msg);
// elanous 네이티브 발송(/v1/outbound → 텔레그램, 실패 시 텔레그램 직접 fallback).
if (sendOutbound(msg, 'alert')) {
  markNotified(now, undefined, cur);  // 하락 움직임 알림 스팸 방지용 현재가 기록
  console.log('\n✅ 텔레그램 발송');
} else {
  console.error('발송 실패(/v1/outbound + 텔레그램 직접 모두 실패)');
  process.exit(1);
}
