// ── KORU 재진입 감시 (매도 스윙의 반대·분할 매수 타이밍) ──────────────
//
// 전량 매도($653 상한가) 후 재진입 타이밍 감시. 3X ETF 재진입은 "과다 하락"만
// 으로 들어가면 위험(3X 하락+decay) → **국면(EWY 200MA 위) + 되돌림 레벨 도달
// + 과매도(vz)** 3-요소 게이트. 급등 직후 추격 방지.
//
// 기초자산 EWY(iShares MSCI South Korea·KORU 3X 대상)로 국면·과매도 판정하고,
// 갭모델(KORU=ANCHOR×(1+L×(EWY/EWY_ANCHOR-1)))로 KORU 환산가 표시. READ-ONLY
// 판단 — 실 매수는 verify+HITL. 이 모듈은 신호 판정·알림 메시지만.

// 갭모델 앵커(KORU 7/2 종가 ↔ EWY 7/2 종가·누적 레버리지 실측 L=2.95).
export const KORU_ANCHOR = 541.43;
export const EWY_ANCHOR = 180.14;
export const KORU_LEVERAGE = 2.95;

/** E-신호(충격반등) 과매도 임계 — EWY vz ≤ -4σ = 진짜 "과다 하락" dip-buy. */
export const VZ_DEEP = -4.0;

export type ReentryZone =
  | 'WAIT_REGIME'  // ★ 캡스톤이 LONG 아님(방어/헤지) → 레버리지 국면 아님·재진입 대기
  | 'CHASE'        // EWY 50MA 위·급등 직후 → 추격 금지(관망)
  | 'WATCH'        // 50MA 근접 → 1차 진입 준비
  | 'ENTER_1'      // EWY ≤ 50MA + 국면OK → 1차 분할 진입
  | 'ENTER_2'      // 50MA 아래 더 → 2차 추가
  | 'ENTER_CORE'   // 랠리 시작점(앵커) 회귀 → 코어 재진입
  | 'DEEP_OVERSOLD'// vz ≤ -4σ → 강한 dip-buy(E-신호)
  | 'REGIME_BREAK';// EWY < 200MA → 구조 붕괴·재진입 금지

export interface ReentryEval {
  koru: number;
  ewy: number;
  ma50: number;
  ma200: number;
  ewyVs50: number;    // EWY 50MA 대비 %
  ewyVs200: number;   // EWY 200MA 대비 %
  vz: number;         // 15일 고점比 낙폭 / 21일 변동성 (과매도도)
  regimeOk: boolean;  // EWY > 200MA (구조적 상승국면)
  zone: ReentryZone;
  /** 캡스톤 게이트를 무시한 순수 가격 밴드 — WAIT_REGIME 중에도 "지금 어디쯤"
   *  을 보는 타이밍 관찰용(2026-07-07 대표 지시: 면밀 관찰). zone이
   *  WAIT_REGIME이 아닐 땐 zone과 동일. */
  subZone: ReentryZone;
  signal: boolean;    // 재진입 후보(ENTER_* 또는 DEEP_OVERSOLD)
  koruAt: (ewy: number) => number; // EWY→KORU 환산
}

const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
function sampleStd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function pctChange(a: number[]): number[] { const o: number[] = []; for (let i = 1; i < a.length; i++) o.push(a[i] / a[i - 1] - 1); return o; }

/** EWY → KORU 환산(갭모델). */
export function koruFromEwy(ewy: number): number {
  return KORU_ANCHOR * (1 + KORU_LEVERAGE * (ewy / EWY_ANCHOR - 1));
}

/** 재진입 평가 — 라이브 KORU·EWY + EWY EOD 히스토리(MA·vz) + **캡스톤 국면**.
 *  ★ 재진입은 캡스톤 종속: capstoneLong(삼성 LONG 국면)이 아니면 EWY가 200MA
 *  위여도 WAIT_REGIME(레버리지 국면 아님·대기). "강세장에서만 재진입" 원칙을
 *  캡스톤(반도체 리더 삼성)으로 판정. capstoneLong=true 일 때만 dip-buy 진입. */
export function evaluateReentry(koru: number, ewyLive: number, ewyCloses: number[], capstoneLong: boolean): ReentryEval {
  const ma200 = ewyCloses.length >= 200 ? mean(ewyCloses.slice(-200)) : mean(ewyCloses);
  const ma50 = ewyCloses.length >= 50 ? mean(ewyCloses.slice(-50)) : mean(ewyCloses);
  const hi15 = ewyCloses.length ? Math.max(...ewyCloses.slice(-15), ewyLive) : ewyLive;
  const dd15 = hi15 > 0 ? ewyLive / hi15 - 1 : 0;
  const vol = sampleStd(pctChange(ewyCloses).slice(-21));
  const vz = vol > 0 ? dd15 / vol : 0;
  const regimeOk = ewyLive > ma200;
  const ewyVs50 = ma50 > 0 ? ewyLive / ma50 - 1 : 0;
  const ewyVs200 = ma200 > 0 ? ewyLive / ma200 - 1 : 0;

  // 순수 가격 밴드(캡스톤 게이트 무시) — 타이밍 관찰용 subZone의 원천.
  let band: ReentryZone;
  if (vz <= VZ_DEEP) band = 'DEEP_OVERSOLD';                  // 과매도 급락(강)
  else if (ewyLive <= EWY_ANCHOR) band = 'ENTER_CORE';        // 랠리 시작점 회귀
  else if (ewyVs50 <= -0.03) band = 'ENTER_2';                // 50MA -3% 아래
  else if (ewyVs50 <= 0) band = 'ENTER_1';                    // 50MA 이하
  else if (ewyVs50 <= 0.015) band = 'WATCH';                  // 50MA 근접
  else band = 'CHASE';                                        // 50MA 위·급등 직후

  let zone: ReentryZone;
  if (!regimeOk) zone = 'REGIME_BREAK';                       // 구조 붕괴(EWY 200MA 아래) 최우선
  else if (!capstoneLong) zone = 'WAIT_REGIME';              // ★ 캡스톤 방어 → 레버리지 국면 아님·대기
  else zone = band;

  const subZone: ReentryZone = !regimeOk ? 'REGIME_BREAK' : band;
  const signal = capstoneLong && regimeOk && (zone === 'ENTER_1' || zone === 'ENTER_2' || zone === 'ENTER_CORE' || zone === 'DEEP_OVERSOLD');

  return { koru, ewy: ewyLive, ma50, ma200, ewyVs50, ewyVs200, vz, regimeOk, zone, subZone, signal, koruAt: koruFromEwy };
}

const Z_LABEL: Record<ReentryZone, string> = {
  WAIT_REGIME: '⏸️ 대기 — 캡스톤 방어 국면(레버리지 아님·삼성 R3 회복 전엔 진입 X)',
  CHASE: '관망(급등 직후·추격 금지)',
  WATCH: '50MA 근접 — 1차 진입 준비',
  ENTER_1: '1차 분할 진입 검토',
  ENTER_2: '2차 추가 진입',
  ENTER_CORE: '코어 재진입(랠리 시작점 회귀)',
  DEEP_OVERSOLD: '⚡ 과매도 급락(E-신호) — 강한 dip-buy',
  REGIME_BREAK: '🚫 구조 붕괴(EWY 200MA 아래) — 재진입 금지',
};

// ── 재진입 분할 매수 래더 (EWY 되돌림 기준·피라미드 다운·동적) ─────────
// ★ KORU 지정가는 고정이 아니라 **EWY 되돌림 레벨에서 매 세션 재계산**(3X decay로
//   같은 KORU 가격이 다른 EWY에 대응하므로). 아래로 갈수록 물량↑(코어 최대).
export interface LadderStep { ewy: number; qty: number; tag: string; core?: boolean; conditional?: boolean }
/** 현재 EWY MA/앵커 기준 래더 스텝(EWY 레벨 + 물량). koruAt 으로 KORU 환산은 동적. */
export function reentryLadder(ma50: number): LadderStep[] {
  return [
    { ewy: ma50, qty: 100, tag: '1차(EWY 50MA)' },
    { ewy: ma50 * 0.975, qty: 150, tag: '2차(-2.5%)' },
    { ewy: EWY_ANCHOR, qty: 200, tag: '코어(랠리 시작점)', core: true },
    { ewy: EWY_ANCHOR * 0.965, qty: 100, tag: '딥(오버슛)', conditional: true },
  ];
}

/** 재진입 예약주문 래더 — **매 세션 EWY로 KORU 지정가 동적 재계산**. 3X decay로
 *  고정 KORU 레벨은 표류하므로, 예약주문도 이 값으로 갱신해야 의미가 있다. */
export function formatReentryOrderPlan(e: ReentryEval): string {
  const lines: string[] = ['[예약주문 매수 래더 — EWY 기준·KORU 지정가 동적]'];
  const steps = reentryLadder(e.ma50);
  let cQty = 0, cCost = 0;
  for (const s of steps) {
    const koruPx = e.koruAt(s.ewy);
    const done = e.koru <= koruPx;
    const gap = (e.koru / koruPx - 1) * 100;
    const status = done ? '✅ 도달(체결권)' : `⏳ KORU가 −${gap.toFixed(1)}% 내려오면`;
    const flags = `${s.core ? '·코어' : ''}${s.conditional ? '·딥(조건부)' : ''}`;
    if (s.ewy >= EWY_ANCHOR * 0.99) { cQty += s.qty; cCost += s.qty * koruPx; } // 코어까지 투영
    lines.push(`  ${s.tag}: EWY $${s.ewy.toFixed(0)} → **KORU $${koruPx.toFixed(0)}** ${s.qty}주${flags} — ${status}`);
  }
  if (cQty > 0) lines.push(`코어까지 체결 시: ${cQty}주 · 평단 ~$${(cCost / cQty).toFixed(0)}`);
  lines.push(e.signal
    ? '🟢 캡스톤 LONG + 되돌림 도달 — 지정가 매수 세팅/유지'
    : e.zone === 'WAIT_REGIME' ? '⏸️ 캡스톤 방어 국면 — 예약주문 걸지 말 것(레버리지 국면 아님)'
    : e.zone === 'REGIME_BREAK' ? '🚫 EWY 200MA 이탈 — 미체결 예약 전량 취소'
    : '되돌림 대기 — 도달 시 세팅');
  lines.push('※ 3X decay로 KORU 지정가는 매 아침 재계산 — 브로커 예약주문도 이 값으로 갱신할 것.');
  return lines.join('\n');
}

/** 재진입 알림 메시지(삼성증권 매수 검토용). */
export function formatReentryAlert(e: ReentryEval): string {
  const lines: string[] = ['📥 KORU 재진입 감시', ''];
  lines.push(`상태: ${Z_LABEL[e.zone]}`);
  // WAIT_REGIME 중에도 가격 밴드는 노출 — 타이밍 관찰(2026-07-07 대표 지시).
  if (e.zone === 'WAIT_REGIME' && e.subZone !== e.zone) lines.push(`가격 밴드(참고): ${Z_LABEL[e.subZone]}`);
  lines.push(`KORU $${e.koru.toFixed(0)} · EWY $${e.ewy.toFixed(1)} (50MA ${(e.ewyVs50 * 100).toFixed(1)}% · 200MA ${(e.ewyVs200 * 100).toFixed(0)}%) · vz ${e.vz.toFixed(2)}σ`);
  lines.push('');
  if (e.signal) {
    lines.push('✅ 재진입 조건 충족 — 분할 매수 검토');
  } else if (e.zone === 'REGIME_BREAK') {
    lines.push('한국 구조적 상승국면 이탈 → 재진입 보류(딥매수 금지)');
  } else {
    lines.push('아직 진입 타이밍 아님 — 되돌림 대기');
  }
  lines.push('');
  lines.push('[분할 매수 래더 — EWY 되돌림 기준]');
  lines.push(`1차 EWY 50MA($${e.ma50.toFixed(0)}) → KORU ~$${e.koruAt(e.ma50).toFixed(0)}`);
  lines.push(`2차 EWY -6% → KORU ~$${e.koruAt(e.ma50 * 0.97).toFixed(0)}`);
  lines.push(`코어 EWY $${EWY_ANCHOR.toFixed(0)}(랠리 시작점) → KORU ~$${koruFromEwy(EWY_ANCHOR).toFixed(0)}`);
  lines.push('');
  // 실제 걸어둘 예약주문 래더(현재가/국면 기준 자동 갱신).
  lines.push(formatReentryOrderPlan(e));
  lines.push('');
  lines.push('※ 확인: 외국인 순매도→순매수 전환 · KORU 저점 낮추기 멈춤(안정화) 후 진입. READ-ONLY·실 매수는 증권사·verify+HITL.');
  return lines.join('\n');
}

/** 알림 발송 여부: zone 이 바뀌었을 때(추격→진입 신호 전환 등)만. */
export function shouldAlertReentry(zone: ReentryZone, lastZone: string): boolean {
  if (zone === lastZone) return false;
  // CHASE↔WATCH 사이 오가는 소음은 억제, 실제 진입/금지 신호만 알림.
  const notable: ReentryZone[] = ['WAIT_REGIME', 'ENTER_1', 'ENTER_2', 'ENTER_CORE', 'DEEP_OVERSOLD', 'REGIME_BREAK', 'WATCH'];
  return notable.includes(zone);
}
