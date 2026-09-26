#!/usr/bin/env bun
// ── 삼성전자 + KORU 통합 워치 (2026-07-07 대표 지시) ─────────────────────
// "삼성 200주(평단 ₩309,125)와 KORU 두 종목 면밀 관찰 + 외국인/기관 수급
// 10분 체크"(대표 조정: 15→10분). 10분 크론이 체크하고 **유의 변화 시에만** 알림:
//   ① 수급 부호 전환 — KOSPI 외국인/기관 · KOSDAQ 외국인 · 삼성 개별 외국계
//      순매수(당일 누계 — KIS 실시간). ★ 대표 07-07: "수급의 변경만 확실하게"
//   ② 수급 흐름 전환 조짐 — 10분 델타가 누계 방향과 반대 & 규모 유의
//      (부호 전환 전 단계 조기 감지 · KOSPI 외국인 축)
//   ③ KORU 가격 밴드(subZone) 변화
//   ④ 삼성 이벤트: 평단/R3 회복 · 일중 ±3% 급변(전환 1회)
//   ⑤ 첫 실행 baseline 브리핑 1회. 거래원 명단은 표기 안 함(대표 — 수급만)
// 변화 없으면 무발송(로그만) — 10분 스팸 없음. 야간엔 sendOutbound 보류큐.
// cron: */10 9-15 * * 1-5 (KR 장중·수급 포함) · */10 22-23 * * 1-5 +
//       */10 0-5 * * 2-6 (US 세션·KORU/삼성ADR 축 — 수급 skip)
// READ-ONLY 관찰 — 매매는 verify+HITL.

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

import { evaluateReentry, EWY_ANCHOR } from '../src/domains/koru-reentry.js';
import { fetchEodCloses, calcR3Level } from '../src/domains/capstone-signals.js';
import { fetchTossQuote } from '../src/domains/toss-quote.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { marketSessions } from '../src/domains/finance.js';
import { buildFinanceTools } from '../src/domains/finance-tools.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const STATE = join(homedir(), '.elanous/conatus/samsung_koru_watch.json');
const POSITION = join(homedir(), '.elanous/conatus/samsung_position.json');

interface WatchState {
  lastSubZone?: string;
  lastForeignSign?: number;  // -1/0/1 (KOSPI 당일 외국인 누계)
  lastInstSign?: number;
  lastKosdaqForeignSign?: number;
  lastSamsungForeignSign?: number; // 삼성 개별 외국계 순매수(주) 부호
  lastSamsungInstSign?: number;    // 삼성 개별 기관 추정(주) 부호 — 티어1
  lastScrtSign?: number;           // KOSPI 금융투자 세분류 부호 — 티어1
  lastPensionSign?: number;        // KOSPI 연기금등 세분류 부호 — 티어1
  lastForeignAmt?: number;   // KOSPI 외국인 누계(백만) — 10분 델타용
  lastFlowHintSign?: number; // 흐름 전환 조짐 알림 상태(중복 억제)
  lastSamsungBand?: string;  // below-avg | above-avg | near-r3 | r3-recovered
  lastBigMove?: number;      // -1/0/1 — 일중 ±3% 급변 상태 (전환 시 1회만 알림)
  updatedAt?: string;
}
function loadState(): WatchState {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf-8')) : {}; } catch { return {}; }
}
function saveState(s: WatchState): void {
  if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
}
function loadPosition(): { shares: number; avgPrice: number } {
  try {
    const p = JSON.parse(readFileSync(POSITION, 'utf-8'));
    return { shares: Number(p.shares) || 0, avgPrice: Number(p.avgPrice) || 0 };
  } catch { return { shares: 0, avgPrice: 0 }; }
}

const km = marketSessions();
const krSession = km.kr === 'OPEN' || km.krLive; // 정규+NXT
const state = loadState();
const changes: string[] = [];
const lines: string[] = [];

// ── 삼성전자 (토스 라이브 · 전 세션) ──
const pos = loadPosition();
const sam = fetchTossQuote('005930');
let samsungBand = state.lastSamsungBand ?? '';
if (sam?.last) {
  const chg = sam.prevClose ? (sam.last / sam.prevClose - 1) * 100 : null;
  const samCloses = fetchEodCloses('005930.KO', '-3m');
  const r3 = samCloses.length >= 6 ? calcR3Level(samCloses) : null;
  const pnl = pos.shares > 0 && pos.avgPrice > 0
    ? ` · 보유 ${pos.shares}주 손익 ${((sam.last / pos.avgPrice - 1) * 100).toFixed(1)}%(₩${Math.round((sam.last - pos.avgPrice) * pos.shares / 10000)}만)`
    : '';
  lines.push(`삼성 ₩${sam.last.toLocaleString()}${chg !== null ? ` (${chg > 0 ? '+' : ''}${chg.toFixed(1)}%)` : ''}${pnl}`);
  if (r3) lines.push(`  R3(5일 신고가) ₩${r3.toLocaleString()} — ${((sam.last / r3 - 1) * 100).toFixed(1)}% 거리`);

  const band = r3 && sam.last >= r3 ? 'r3-recovered'
    : r3 && sam.last >= r3 * 0.98 ? 'near-r3'
    : pos.avgPrice > 0 && sam.last >= pos.avgPrice ? 'above-avg' : 'below-avg';
  if (state.lastSamsungBand && band !== state.lastSamsungBand) {
    const label: Record<string, string> = {
      'r3-recovered': '🟢 삼성 R3 회복 — 캡스톤 LONG 전환 임박(다음 크론 확정)',
      'near-r3': '👀 삼성 R3 -2% 이내 접근',
      'above-avg': '✅ 삼성 평단(₩309,125) 회복',
      'below-avg': '삼성 평단 아래 복귀',
    };
    changes.push(label[band] ?? `삼성 밴드 ${state.lastSamsungBand}→${band}`);
  }
  // 급변은 상태 전환 시 1회만 (±3% 유지 중 매 런 재발송 방지)
  const bigMove = chg === null ? 0 : chg >= 3 ? 1 : chg <= -3 ? -1 : 0;
  if (bigMove !== 0 && bigMove !== (state.lastBigMove ?? 0)) changes.push(`⚡ 삼성 일중 ${chg! > 0 ? '+' : ''}${chg!.toFixed(1)}% 급변`);
  samsungBand = band;
  state.lastBigMove = bigMove;
}

// ── KORU / EWY 밴드 (전 세션 — 토스 주간거래 커버) ──
let subZone = state.lastSubZone ?? '';
const koru = fetchTossQuote('KORU');
const ewy = fetchTossQuote('EWY');
if (koru?.last && ewy?.last) {
  const ewyCloses = fetchEodCloses('EWY.US', '-1y');
  if (ewyCloses.length >= 60) {
    // capstoneLong은 여기선 미판정(무거움) — subZone(가격 밴드)만 관찰. 정식
    // 진입 신호는 koru-reentry-alert(08:35)와 캡스톤 크론이 판정.
    const e = evaluateReentry(koru.last, ewy.last, ewyCloses, false);
    lines.push(`KORU $${e.koru.toFixed(0)} · EWY $${e.ewy.toFixed(1)} (50MA ${(e.ewyVs50 * 100).toFixed(1)}%·200MA ${(e.ewyVs200 * 100).toFixed(0)}%) · vz ${e.vz.toFixed(2)}σ`);
    lines.push(`  가격 밴드: ${e.subZone}${e.regimeOk ? '' : ' 🚫구조붕괴'}`);
    // 히스테리시스 — ENTER_CORE↔ENTER_2 경계는 앵커($180.14) 단일점이라 EWY가
    // 앵커 부근을 오가면 밴드가 flip-flop(왕복 스팸). 앵커 ±0.5% 완충대 안의
    // CORE↔ENTER_2 왕복은 억제하고, 완충대를 확실히 벗어난 전환만 알림.
    const anchorFlip =
      (e.subZone === 'ENTER_CORE' && state.lastSubZone === 'ENTER_2') ||
      (e.subZone === 'ENTER_2' && state.lastSubZone === 'ENTER_CORE');
    const inAnchorBuffer = Math.abs(ewy.last / EWY_ANCHOR - 1) <= 0.005;
    const suppress = anchorFlip && inAnchorBuffer;
    if (state.lastSubZone && e.subZone !== state.lastSubZone && !suppress) {
      changes.push(`📥 KORU 밴드 전환: ${state.lastSubZone} → ${e.subZone}`);
    }
    // 완충대 안에서 억제하는 동안엔 lastSubZone을 갱신하지 않아 상태를 고정
    // (완충대를 벗어나 실제 전환될 때 직전 확정 밴드와 비교되도록).
    subZone = suppress ? state.lastSubZone! : e.subZone;
  }
}

// ── 수급 전환 감지 (KR 장중만 — KIS 당일 누계 + 10분 델타) ──
let foreignSign = state.lastForeignSign ?? 0;
let instSign = state.lastInstSign ?? 0;
let kosdaqForeignSign = state.lastKosdaqForeignSign ?? 0;
let samsungForeignSign = state.lastSamsungForeignSign ?? 0;
let samsungInstSign = state.lastSamsungInstSign ?? 0;
let scrtSign = state.lastScrtSign ?? 0;
let pensionSign = state.lastPensionSign ?? 0;
let foreignAmt = state.lastForeignAmt;
let flowHintSign = state.lastFlowHintSign ?? 0;
if (krSession) {
  const { dispatch } = buildFinanceTools();
  const marketNet = async (target: string): Promise<{ fr: number; inst: number } | null> => {
    try {
      const r: any = await dispatch('finance_kr_flow', { command: 'market-flow', target });
      const row = String(r.report ?? '').split('\n').find(l => /\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
      if (!row) return null;
      const cells = row.split('|').map(x => x.trim());
      const fr = Number(cells[2]?.replace(/,/g, '')), inst = Number(cells[3]?.replace(/,/g, ''));
      return Number.isFinite(fr) && Number.isFinite(inst) ? { fr, inst } : null;
    } catch { return null; }
  };
  const flip = (label: string, v: number, last: number | undefined, setter: (s: number) => void, fmt: (n: number) => string = n => `${(n / 1e6).toFixed(2)}조`): void => {
    const sign = Math.sign(v);
    if (last !== undefined && sign !== last && sign !== 0) {
      changes.push(`🔄 ${label} ${sign > 0 ? '순매수 전환 ✅' : '순매도 전환'} (${fmt(v)})`);
    }
    setter(sign);
  };

  const ksp = await marketNet('KSP');
  if (ksp) {
    lines.push(`KOSPI 수급(당일): 외국인 ${(ksp.fr / 1e6).toFixed(2)}조 · 기관 ${(ksp.inst / 1e6).toFixed(2)}조`);
    flip('KOSPI 외국인', ksp.fr, state.lastForeignSign, s2 => { foreignSign = s2; });
    flip('KOSPI 기관', ksp.inst, state.lastInstSign, s2 => { instSign = s2; });
    // 흐름 전환 조짐 — 10분 델타가 누계 방향과 반대 & |델타| ≥ max(300억, 누계의 10%)
    if (state.lastForeignAmt !== undefined) {
      const delta = ksp.fr - state.lastForeignAmt;
      const meaningful = Math.abs(delta) >= Math.max(30_000, Math.abs(ksp.fr) * 0.1);
      const against = Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(ksp.fr);
      const hint = meaningful && against ? Math.sign(delta) : 0;
      if (hint !== 0 && hint !== flowHintSign) {
        changes.push(`〽️ KOSPI 외국인 흐름 전환 조짐 — 10분 ${delta > 0 ? '+' : ''}${(delta / 1e4).toFixed(0)}억 ${delta > 0 ? '유입' : '유출'} (누계 ${(ksp.fr / 1e6).toFixed(2)}조 대비 역방향)`);
      }
      flowHintSign = hint;
    }
    foreignAmt = ksp.fr;
  }
  const ksq = await marketNet('KSQ');
  if (ksq) {
    lines.push(`KOSDAQ 수급(당일): 외국인 ${(ksq.fr / 1e6).toFixed(2)}조 · 기관 ${(ksq.inst / 1e6).toFixed(2)}조`);
    flip('KOSDAQ 외국인', ksq.fr, state.lastKosdaqForeignSign, s2 => { kosdaqForeignSign = s2; });
  }
  // 티어1(2026-07-07 대표 승인) — KOSPI 투자자 세분류(장중 잠정 · [0403]):
  // 금융투자·연기금 같은 "누가 사고파는지"를 10분 단위로. 절대값은 잠정 스케일
  // — 부호/전환 감지용.
  try {
    const r: any = await dispatch('finance_kr_flow', { command: 'investor-time' });
    const rep = String(r.report ?? '');
    const pick = (label: string): number | null => {
      const m = rep.match(new RegExp(`\\| ${label} \\| (-?[\\d,]+) \\|`));
      return m ? Number(m[1]!.replace(/,/g, '')) : null;
    };
    const scrt = pick('금융투자'), pension = pick('연기금등'), ivtr = pick('투신'), pe = pick('사모펀드');
    if (scrt !== null || pension !== null) {
      const fmtB = (n: number | null) => n === null ? '?' : `${(n / 100).toFixed(0)}억`; // 백만→억
      lines.push(`KOSPI 세분류(잠정): 금융투자 ${fmtB(scrt)} · 연기금 ${fmtB(pension)} · 투신 ${fmtB(ivtr)} · 사모 ${fmtB(pe)}`);
      if (scrt !== null) flip('KOSPI 금융투자', scrt, state.lastScrtSign, s2 => { scrtSign = s2; }, n => `${(n / 100).toFixed(0)}억`);
      if (pension !== null) flip('KOSPI 연기금', pension, state.lastPensionSign, s2 => { pensionSign = s2; }, n => `${(n / 100).toFixed(0)}억`);
    }
  } catch { /* fail-soft */ }
  // 삼성 개별 — 외인·기관 추정가집계(차수별 누계 · 기관 수급 최초 노출)
  try {
    const r: any = await dispatch('finance_kr_flow', { command: 'estimate', symbol: '005930' });
    const rows = String(r.report ?? '').split('\n').filter(l => /^\| \d \|/.test(l));
    const last = rows[rows.length - 1];
    if (last) {
      const c = last.split('|').map(x => x.trim());
      const frgn = Number(c[2]?.replace(/,/g, '')), inst = Number(c[3]?.replace(/,/g, ''));
      if (Number.isFinite(inst)) {
        lines.push(`삼성 추정가집계(차수${c[1]}): 외인 ${(frgn / 10_000).toFixed(0)}만주 · 기관 ${(inst / 10_000).toFixed(0)}만주`);
        flip('삼성 기관(추정)', inst, state.lastSamsungInstSign, s2 => { samsungInstSign = s2; }, n => `${(n / 10_000).toFixed(0)}만주`);
      }
    }
  } catch { /* fail-soft */ }
  // 삼성 개별 — 외국계 순매수(주 · 거래원 명단 없이 순매수만: KIS 회원사 TR의 외국계 추정합)
  try {
    const r: any = await dispatch('finance_kr_flow', { command: 'member', symbol: '005930' });
    const m = String(r.report ?? '').match(/순매수 ([+-][\d,]+)주/);
    if (m) {
      const net = Number(m[1]!.replace(/,/g, ''));
      lines.push(`삼성 외국계 순매수(당일): ${net > 0 ? '+' : ''}${(net / 10_000).toFixed(0)}만주`);
      flip('삼성 외국계', net, state.lastSamsungForeignSign, s2 => { samsungForeignSign = s2; }, n => `${(n / 10_000).toFixed(0)}만주`);
    }
  } catch { /* fail-soft */ }
}

const firstRun = !state.updatedAt;
console.log(lines.join('\n') || '(시세 조회 실패)');
console.log(changes.length ? `변화: ${changes.join(' · ')}` : '유의 변화 없음');

if ((changes.length > 0 || firstRun) && lines.length > 0) {
  const msg = [
    firstRun ? '👁 삼성·KORU 워치 시작 (10분 체크·변화 시만 알림)' : `👁 삼성·KORU 워치 — ${changes.length}건 변화`,
    ...changes.map(c => `• ${c}`),
    '',
    ...lines,
    '',
    '(READ-ONLY 관찰 · 진입 신호는 캡스톤/재진입 크론 판정 · 매매는 verify+HITL)',
  ].join('\n');
  if (!sendOutbound(msg, 'alert')) console.error('발송 실패');
}
saveState({
  lastSubZone: subZone, lastForeignSign: foreignSign, lastInstSign: instSign,
  lastKosdaqForeignSign: kosdaqForeignSign, lastSamsungForeignSign: samsungForeignSign,
  lastSamsungInstSign: samsungInstSign, lastScrtSign: scrtSign, lastPensionSign: pensionSign,
  ...(foreignAmt !== undefined ? { lastForeignAmt: foreignAmt } : {}),
  lastFlowHintSign: flowHintSign,
  lastSamsungBand: samsungBand, lastBigMove: state.lastBigMove ?? 0,
});
