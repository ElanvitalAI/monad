#!/usr/bin/env bun
// ── 캡스톤 국면 전환 알림 (삼성전자 · R3 LONG 포함) ───────────────────
// ABCDE 신호(토스 우선 실시간) → 국면(LONG/CASH/HEDGE) + 레버리지 배수. 국면이
// 바뀌면(특히 R3 회복 → LONG 1.5×, 또는 E-신호 과도폭락 dip-buy) 텔레그램 발송.
// READ-ONLY 판단 — 실 매매는 verify+HITL. cron: */10 9-16 + 22,23,0-5 (KST).

import { computeAbcdeSignals, fetchEodCloses, fetchLiveQuote, decideTarget } from '../src/domains/capstone-signals.js';
import { decideLeverage } from '../src/domains/capstone-leverage.js';
import { fetchTossQuote } from '../src/domains/toss-quote.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { marketSessions } from '../src/domains/finance.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 크론 최소 PATH엔 npx/node 없음 → fetchEodCloses(npx tsx) 실패 → 신호 붕괴.
// ⚠️ homebrew/bun 주입만으론 부족(이 머신 node=nvm 전용) — 07-07 관찰에서
// reliable=false 연쇄의 근본원인으로 실측. 공유 헬퍼로 nvm bin까지 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const STATE = join(homedir(), '.elanous/conatus/capstone_regime.json');
function loadLast(): string { try { return existsSync(STATE) ? String(JSON.parse(readFileSync(STATE, 'utf-8')).lastTarget ?? '') : ''; } catch { return ''; } }
function saveLast(t: string): void { if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify({ lastTarget: t, updatedAt: new Date().toISOString() }, null, 2)); }

const mkt = marketSessions();
const sig = computeAbcdeSignals(fetchEodCloses, fetchLiveQuote,
  { usEtLive: mkt.usLive, usOvernight: mkt.usOvernight, krRegular: mkt.kr === 'OPEN', krNxt: mkt.krLive && mkt.kr !== 'OPEN' },
  fetchTossQuote);
const today = mkt.kstLabel.trim().split(' ')[0];
const { target } = decideTarget(sig, { dHedgeActive: false, dHedgeUntil: null }, today);
const plan = decideLeverage(target, sig.a || sig.b, sig.r3);
const sam = fetchTossQuote('005930');

console.log(`캡스톤: ${target} · ${plan.label} · R3=${sig.r3} · E=${sig.eFire} · reliable=${sig.reliable} · 삼성 ₩${sam?.last}`);

// ── 대시보드용 A~E 스냅샷 영속 (매 실행 — 알림 여부와 무관 · 대표 지시 2026-07-07) ──
try {
  const SNAP = join(homedir(), '.elanous/conatus/capstone_signals.json');
  writeFileSync(SNAP, JSON.stringify({
    ts: new Date().toISOString(),
    reliable: sig.reliable,
    target,
    regime: plan.regime,
    label: plan.label,
    targetExposure: plan.targetExposure,
    samsung: sam?.last ?? null,
    r3Level: sig.r3Level ?? null,
    signals: {
      // 표기 원칙: 🔴=방어(약세) 요인 발동 · 🟢=정상. E만 성격이 반대(발동=기회).
      A: {
        name: '크로스에셋', bear: sig.a,
        detail: [
          sig.aXa ? `XA ${sig.aXa.riskOff ? '자금이탈' : '정상'}(한주식 rank ${sig.aXa.rank}·z ${sig.aXa.z})` : 'XA 판정불가',
          sig.aKrw ? '원화 약세' : '원화 안정',
        ].join(' · '),
      },
      B: { name: '삼성 낙폭', bear: sig.b, detail: sig.b ? `고점比 ${(sig.bDd * 100).toFixed(1)}% (임계 초과)` : '임계 이내' },
      C: { name: 'R3 회복', bear: !sig.r3, detail: sig.r3 ? '회복✅ → LONG' : sig.r3Level ? `미회복 (기준 ₩${sig.r3Level.toLocaleString()})` : '미회복' },
      D: { name: '美충격(PSD)', bear: sig.dK > 0, detail: `${sig.dK}/2 신호 (SOXL ${sig.dDetail.SOXL}·${sig.dDetail.live})` },
      E: { name: '급락기회', bear: false, detail: sig.eFire ? '⚡발동 — dip-buy 자리' : `미발동 (vz ${sig.eVz.toFixed(1)}σ / 기준 -4σ)` },
    },
  }, null, 1));
} catch { /* fail-soft — 스냅샷 실패해도 알림 흐름 유지 */ }

// ★ fail-closed: EOD 데이터 조회 실패로 신호가 붕괴(거짓 Bull→LONG)했으면 절대 발송 안 함.
if (!sig.reliable) { console.log('데이터 부족(EOD 조회 실패) — 신호 신뢰 불가·발송 skip'); process.exit(0); }

const last = loadLast();
if (target === last) { console.log(`국면 변화 없음(${last}) — 발송 skip`); process.exit(0); }

// 메시지 구성
const isLongFlip = target === 'LONG_100' && last && last !== 'LONG_100';
const lines: string[] = ['📊 캡스톤 국면 전환 (삼성전자)', ''];
lines.push(`▶ ${last || '(초기)'} → ${target} · ${plan.label}`);
if (isLongFlip) lines.push(`🟢 상승국면 전환 — 레버리지 진입 가능 국면 (${sig.r3 ? 'R3 신고가회복' : '약세 아님'})`);
if (sig.eFire) lines.push(`⚡ E-신호(과도폭락 충격반등) 발동 — 레버리지 dip-buy 자리`);
if (target.startsWith('HEDGE')) lines.push(`🚨 PSD(미국 반도체 충격) 방어 — 헤지`);
lines.push('');
if (sam?.last) lines.push(`삼성 ₩${sam.last.toLocaleString()} (${sam.prevClose ? ((sam.last / sam.prevClose - 1) * 100).toFixed(1) + '%' : '?'})`);
// A = 원화 OR XA(#3269) — 발화 레그를 명시 (07-07 대표 혼란: 'A 원화'로만
// 표기돼 XA 자금이탈이 발화해도 원화약세로 읽힘). 예: A Bear[XA z-2.2] · A Bear[원화+XA].
const aLegs = [sig.aKrw ? '원화' : '', sig.aXa?.riskOff ? `XA z${sig.aXa.z.toFixed(1)}` : ''].filter(Boolean).join('+');
lines.push(`A ${sig.a ? `Bear[${aLegs || '?'}]` : `Bull${sig.aXa ? '' : '(XA판정불가·원화만)'}`} · B 낙폭 ${sig.b ? `Bear(${(sig.bDd * 100).toFixed(1)}%)` : 'Bull'} · C R3 ${sig.r3 ? '회복✅' : '미회복'}`);
lines.push(`D PSD K=${sig.dK}(${sig.dDetail.SOXL}·${sig.dDetail.live}) · E ${sig.eFire ? '발동' : `미발동(vz ${sig.eVz.toFixed(1)}σ)`}`);
lines.push(`레버리지: ${plan.targetExposure}x (${plan.regime})`);
lines.push('');
lines.push('※ READ-ONLY 판단 · 실 매매는 verify게이트+HITL. R3=삼성 5일 신고가 회복 시 LONG.');
const msg = lines.join('\n');
console.log(msg);

if (sendOutbound(msg, 'alert')) { saveLast(target); console.log('\n✅ 발송'); }
else { console.error('발송 실패'); process.exit(1); }
