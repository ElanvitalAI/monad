// ── Mandate 게이트체인 — 적응형 투자 오토파일럿 A4 (2026-07-11) ────────────────
//
// 2차 확정 신호(권고 adjust)를 mandate 내 자율 조정으로 넘기기 전, **자율주문 게이트체인**
// (엘라누스 자율설계 §12.2)을 통과시킨다. fail-closed·집행0(dry). A5 에서 멱등집행·브로커 배선.
//
//   최신성 → 독립성 → 신뢰도 → 국면 → mandate(리스크/한도/arming/마켓클럭·evaluateMandate)
//
// ★ 보호동작 vs 위험확대동작 비대칭(§12.2 대표 채택): 자본을 지키는 보호(매도·헤지·축소)는
//   관대(단일출처·불리한 국면에서도 허용), 위험을 키우는 확대(매수·레버·추가)는 전 게이트
//   통과 요구(다중출처·고신뢰·우호 국면). 모호하면 보호로 보수 분류.
//
// 안전: 항상 dry — mandate.armed=false 면 mandate 게이트가 차단(현 clean-slate 상태). 이 모듈은
//   "만약 재-arm 되면 이 조정이 허용되는가"의 결정 로직을 무집행으로 실증한다.
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §6·§12.2·§12.6(A4).

import type { Signal } from './signal-pool.js';
import { evaluateMandate, type TradeMandate, type MandateVerdict } from './trade-mandate.js';
import type { TradeIntent } from './trade-hitl.js';
import type { MarketSessions } from './finance.js';

export type ActionKind = 'protection' | 'expansion';
export type GateName = 'no-asset' | 'freshness' | 'independence' | 'trust' | 'regime' | 'attractiveness' | 'mandate';

// ★ 방향(매수/매도) 어휘. protect/exit/청산/전량 을 보호에 포함(price-guard 가 쓰는 어휘).
//   확대(standalone)는 확장에서 제거 — "손실확대"·"위험확대" 같은 보호맥락 문구가 매수로
//   오분류돼 실매수 오발주된 근본(2026-07-15). 확장은 "비중/포지션 확대"처럼 명시 접두만 인정.
const PROTECTION_RE = /매도|축소|헤지|방어|현금|익절|손절|청산|전량|보호|protect|exit|비중\s*축소|리스크\s*축소|reduce|hedge|sell|trim|defensive|risk[-\s]?off|de-?risk/i;
const EXPANSION_RE = /매수|레버|추가\s*매수|진입|비중\s*확대|포지션\s*확대|dip[-\s]?buy|\bbuy\b|\badd\b|leverage|increase|scale[-\s]?in|\blong\b/i;

/**
 * 방향을 구조화 필드(proposedAction)만으로 판정. 불명이면 'ambiguous'(자유텍스트/LLM 필요).
 * ★ gate2Reason(LLM 자유텍스트 사유)은 절대 방향 근거로 쓰지 않는다 — 양방향 단어를 담아
 *   보호신호를 확대로 뒤집는다(2026-07-15 실매수 오발주 근본). proposedAction 이 authoritative.
 *   보호마커가 있으면 확장마커 유무와 무관하게 보호(fail-safe: 오분류는 매도쪽으로 기울어야 안전).
 */
export function classifyActionStructured(s: Signal): ActionKind | 'ambiguous' {
  const verb = (s.proposedAction ?? '').toLowerCase();
  if (verb) {
    if (PROTECTION_RE.test(verb)) return 'protection'; // 보호 우선(fail-safe)
    if (EXPANSION_RE.test(verb)) return 'expansion';
  }
  return 'ambiguous';
}

/**
 * 제안 동작을 보호(protection) vs 위험확대(expansion)로 분류(동기·결정론).
 * 구조화 필드 우선 → 불명이면 raw+recommendation 만 보수적으로(사유 제외) → 보호 기본.
 * 비구조 신호의 LLM 분류는 evaluateGateChain 의 ctx.actionOverride 로 주입(runExec 가 async 결정).
 */
export function classifyAction(s: Signal): ActionKind {
  const structured = classifyActionStructured(s);
  if (structured !== 'ambiguous') return structured;
  // 구조 불명 → raw+recommendation 만(자유텍스트 gate2Reason 제외). 보호 우선(둘 다/모호/무 → 보호).
  const hay = `${s.recommendation ?? ''} ${s.raw}`;
  if (PROTECTION_RE.test(hay)) return 'protection';
  if (EXPANSION_RE.test(hay)) return 'expansion';
  return 'protection';
}

/** LLM 방향 분류 seam — 비구조 신호(proposedAction 불명)용. 실패/파싱불가=null(호출측 보호 기본). */
export type ActionClassifier = (s: Signal) => Promise<ActionKind | null>;

/** 기본 LLM 분류기(저비용 haiku). 자유텍스트 신호의 매수/매도 의도를 판정. 안전: 모호=protection. */
export async function classifyActionLLM(s: Signal): Promise<ActionKind | null> {
  try {
    const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
    // 활성 provider의 budget tier를 사용해 cross-family 라우팅 실패를 피한다.
    const { budgetModel } = await import('../llm/model-defaults.js');
    const model = process.env.ELANOUS_ACTION_CLASSIFIER_MODEL || budgetModel();
    const provider = resolveDefaultProvider(model);
    const prompt = [
      'Classify the trade direction implied by this investment signal as EXACTLY one word:',
      'PROTECTION (sell/reduce/hedge/exit — de-risking a held position) or',
      'EXPANSION (buy/add/leverage/enter — increasing risk).',
      'If ambiguous or unclear, answer PROTECTION (capital preservation is the safe default).',
      '', `signal.proposedAction: ${s.proposedAction ?? '(none)'}`,
      `signal.recommendation: ${s.recommendation ?? '(none)'}`,
      `signal.text: ${s.raw.slice(0, 300)}`,
      '', 'Answer with ONE word only: PROTECTION or EXPANSION.',
    ].join('\n');
    let full = '';
    await streamLLM([{ role: 'user', content: prompt }], (_d, all) => { full = all; },
      { model, reasoningEffort: 'minimal', ...(provider ? { provider } : {}) });
    const up = full.toUpperCase();
    if (up.includes('EXPANSION') && !up.includes('PROTECTION')) return 'expansion';
    if (up.includes('PROTECTION')) return 'protection';
    return null;
  } catch { return null; }
}

export interface GateChainContext {
  mandate: TradeMandate;
  /** 현 국면(regime-store latest). 없으면 확대는 국면 게이트에서 차단. */
  regime?: { regimeLabel: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' } | null;
  /** 신호 독립성 — 같은 dedup_group 신호 수(pool.dedupGroupCount). */
  dedupCount?: number;
  /** 종목 매력도(B2·attractiveness-read). null=미스코어(fail-soft·게이트 skip). */
  attractiveness?: { signal: 'BUY' | 'HOLD' | 'SELL' } | null;
  sessions?: MarketSessions;
  now?: number;                 // ms(기본 Date.now 는 스크립트에서 주입)
  freshnessMin?: number;        // 기본 360(6h)
  minTrustExpansion?: number;   // 기본 0.75
  minTrustProtection?: number;  // 기본 0.4
  /** 방향 override(비구조 신호의 LLM 분류 결과 주입). 없으면 결정론 classifyAction. */
  actionOverride?: ActionKind;
}

export interface GateChainVerdict {
  /** 자율 조정 허용 여부(단, 실집행 live 는 mandate.live — 현 dry). */
  permitted: boolean;
  /** 실주문 여부(mandate.armed+live). 현 clean-slate 에선 항상 false(dry). */
  live: boolean;
  action: ActionKind;
  /** 차단한 게이트(통과 시 undefined). */
  blockedGate?: GateName;
  reason: string;
  mandateVerdict?: MandateVerdict;
}

function isStaleMs(gate2At: string | undefined, now: number, freshnessMin: number): boolean {
  if (!gate2At) return true;
  const t = Date.parse(gate2At);
  if (Number.isNaN(t)) return true;
  return now - t > freshnessMin * 60_000;
}

/** 신호 기반 자율 조정이 게이트체인을 통과하는지 판정(dry). 비대칭·fail-closed. */
export function evaluateGateChain(signal: Signal, ctx: GateChainContext): GateChainVerdict {
  const action = ctx.actionOverride ?? classifyAction(signal);
  const now = ctx.now ?? Date.parse(signal.gate2At ?? signal.collectedAt);
  const freshnessMin = ctx.freshnessMin ?? 360;
  const minTrustExp = ctx.minTrustExpansion ?? 0.75;
  const minTrustProt = ctx.minTrustProtection ?? 0.4;
  const block = (blockedGate: GateName, reason: string): GateChainVerdict =>
    ({ permitted: false, live: false, action, blockedGate, reason });

  // 0) 대상 자산 — 조정 대상 심볼이 없으면 intent 구성 불가.
  if (!signal.asset) return block('no-asset', '신호에 대상 자산 없음(조정 대상 불명)');

  // 1) 최신성 — 오래된 확정으로는 조정 안 함(보호/확대 공통).
  if (isStaleMs(signal.gate2At, now, freshnessMin)) return block('freshness', `신호 stale(>${freshnessMin}m·판정 ${signal.gate2At ?? '불명'})`);

  // 2) 독립성 — 확대는 다중출처(dedup≥2) 요구. 보호는 단일출처도 허용(비대칭).
  const dedup = ctx.dedupCount ?? 1;
  if (action === 'expansion' && dedup < 2) return block('independence', `확대는 다중출처 요구(현 dedup ${dedup})`);

  // 3) 신뢰도 — 확대는 고신뢰(≥0.75), 보호는 완화(≥0.4).
  const minTrust = action === 'expansion' ? minTrustExp : minTrustProt;
  if (signal.trust < minTrust) return block('trust', `신뢰도 부족(${signal.trust} < ${minTrust}·${action})`);

  // 4) 국면 — 확대는 우호 국면(RISK_ON) 요구. 보호는 전 국면 허용(RISK_OFF 방어).
  if (action === 'expansion') {
    const label = ctx.regime?.regimeLabel;
    if (label !== 'RISK_ON') return block('regime', `확대는 우호 국면(RISK_ON) 요구(현 ${label ?? '불명'})`);
  }

  // 4.5) 매력도(B2) — 확대는 매력도 SELL 종목에 진입 금지(비대칭·보호는 무관). 미스코어=skip(fail-soft).
  if (action === 'expansion' && ctx.attractiveness?.signal === 'SELL') {
    return block('attractiveness', `확대 차단: 매력도 SELL 종목(${signal.asset})`);
  }

  // 5) mandate — 리스크/한도/arming/마켓클럭(evaluateMandate). 현 armed=false → 여기서 dry 차단.
  const intent: TradeIntent = {
    id: `gatechain-${signal.eventId}`,
    symbol: signal.asset,
    side: action === 'protection' ? 'sell' : 'buy',
    qty: 0,                        // dry — 사이징은 A5 집행 단계.
    reason: `[자율조정·${action}] ${signal.gate2Reason ?? signal.raw.slice(0, 80)}`,
    source: 'signal',
  };
  const mv = evaluateMandate(intent, ctx.mandate, {
    ...(ctx.sessions ? { sessions: ctx.sessions } : {}),
  });
  return {
    permitted: mv.allowed,
    live: mv.live,
    action,
    ...(mv.allowed ? {} : { blockedGate: 'mandate' as GateName }),
    reason: mv.reason,
    mandateVerdict: mv,
  };
}
