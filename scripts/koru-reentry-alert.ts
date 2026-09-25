#!/usr/bin/env bun
// ── KORU 재진입 감시 알림 (하루 1회·평일 아침) ────────────────────────
// 전량 매도 후 재진입 타이밍 감시. ★ 재진입은 **캡스톤 국면 종속**(삼성 LONG
// 아니면 WAIT_REGIME·대기) + EWY 되돌림 레벨 + 과매도(vz). KORU 지정가는 3X decay로
// 매 세션 EWY 재계산(동적). 재진입/캡스톤은 EOD 일봉 신호라 10분 아님 → 평일 아침 1회.
// cron: 30 8 * * 1-5 (KST 08:30·overnight US 반영 후·KR 개장 전).

import { evaluateReentry, formatReentryAlert, shouldAlertReentry } from '../src/domains/koru-reentry.js';
import { computeAbcdeSignals, fetchEodCloses, fetchLiveQuote, decideTarget } from '../src/domains/capstone-signals.js';
import { fetchTossQuote } from '../src/domains/toss-quote.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { marketSessions } from '../src/domains/finance.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 크론 최소 PATH엔 npx/node 없음 → fetchEodCloses(EWY) 실패 방지.
// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const STATE = join(homedir(), '.monad/conatus/koru_reentry.json');

function loadZone(): string { try { return existsSync(STATE) ? String(JSON.parse(readFileSync(STATE, 'utf-8')).lastZone ?? '') : ''; } catch { return ''; } }
function saveZone(zone: string): void { if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ lastZone: zone, updatedAt: new Date().toISOString() }, null, 2)); }

const km = marketSessions();
const koru = fetchTossQuote('KORU');
const ewyQ = fetchTossQuote('EWY');
if (!koru || !ewyQ) { console.log('KORU/EWY 시세 조회 실패 — skip'); process.exit(0); }
const ewyCloses = fetchEodCloses('EWY.US', '-1y');
if (ewyCloses.length < 60) { console.log('EWY 히스토리 부족 — skip'); process.exit(0); }

// ★ 재진입은 캡스톤 국면 종속: 삼성 LONG_100 일 때만 능동 진입, 아니면 WAIT_REGIME.
const today = km.kstLabel.trim().split(' ')[0];
const sig = computeAbcdeSignals(fetchEodCloses, fetchLiveQuote,
  { usEtLive: km.usLive, usOvernight: km.usOvernight, krRegular: km.kr === 'OPEN', krNxt: km.krLive && km.kr !== 'OPEN' },
  fetchTossQuote);
if (!sig.reliable) { console.log('EOD 조회 실패(신호 붕괴) — skip'); process.exit(0); }  // fail-closed
const { target } = decideTarget(sig, { dHedgeActive: false, dHedgeUntil: null }, today);
const capstoneLong = target === 'LONG_100';

const e = evaluateReentry(koru.last, ewyQ.last, ewyCloses, capstoneLong);
console.log(`재진입 zone=${e.zone} · KORU $${e.koru} · EWY $${e.ewy.toFixed(1)}(50MA ${(e.ewyVs50 * 100).toFixed(1)}%·200MA ${(e.ewyVs200 * 100).toFixed(0)}%) · vz ${e.vz.toFixed(2)}σ · signal=${e.signal}`);

const lastZone = loadZone();
if (!shouldAlertReentry(e.zone, lastZone)) { console.log(`zone 변화 없음(${lastZone}→${e.zone}) — 발송 skip`); process.exit(0); }

const msg = formatReentryAlert(e);
console.log(msg);
if (sendOutbound(msg, 'alert')) {
  saveZone(e.zone);
  console.log('\n✅ 텔레그램 발송');
} else {
  console.error('발송 실패');
  process.exit(1);
}
