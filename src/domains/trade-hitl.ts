// ── HITL 매매 실행 상태머신 (P8c 잔여, 2026-07-05) ─────────────────────
//
// 판단(읽기)과 집행(쓰기)의 물리적 분리. 이 모듈은 매매 intent의 lifecycle을
// 오케스트레이션한다: 게이트 검증 → 2단계 사람 승인 → 집행-직전 재검증 → 집행.
//
// ★ 안전의 핵심: `executor`는 주입 의존성이고 기본값은 **하드 거부**다. executor를
//   명시적으로 배선하지 않으면 모든 승인을 통과해도 집행 단계에서 REJECTED 된다.
//   에이전트/자동 경로는 executor를 주입하지 않으므로 절대 주문을 낼 수 없다.
//   fail-closed: 어떤 검증/승인이든 실패·에러·타임아웃 → 즉시 REJECTED(터미널).
//
// 설계 상세: 내부 문서 `PLAN-hitl-trade-execution-2026-07-05`

export type TradeSide = 'buy' | 'sell';

export interface TradeIntent {
  id: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  reason: string;
  source: 'agent' | 'signal' | 'user';
}

export type TradeState =
  | 'PROPOSED' | 'VERIFIED' | 'APPROVED_1' | 'APPROVED_2'
  | 'EXECUTED' | 'FILLED' | 'REJECTED';

export interface ApprovalOutcome { approved: boolean; channel?: string }
export interface GateOutcome { gate: string; detail?: string }
export interface ExecOutcome { filled: boolean; detail: string }

export interface TradeHitlResult {
  intent: TradeIntent;
  state: TradeState;
  /** Gate result used to authorise (re-verify at execution when reached). */
  gate: string;
  reverify?: string;
  approvals: Array<{ stage: 1 | 2 } & ApprovalOutcome>;
  /** Did the money-touching executor actually run? */
  executed: boolean;
  fill?: string;
  rejectReason?: string;
}

export interface TradeHitlDeps {
  /** verify 하드게이트. 'CLEARED'만 통과 (BLOCKED/MARKET_CLOSED/기타 → 거부). */
  verifyGate: () => Promise<GateOutcome>;
  /** 멀티채널 사람 승인(Pushcut/PWA/텔레그램…). stage로 1·2차 구분(2차는 다른
   *  채널 우선하도록 구현측이 오케스트레이션). approved=false = 거부/타임아웃. */
  requestApproval: (prompt: string, stage: 1 | 2) => Promise<ApprovalOutcome>;
  /** ★ money-touch. 주입 안 하면 하드 거부(기본). 오직 사람이 배선한 executor만 집행. */
  executor?: (intent: TradeIntent) => Promise<ExecOutcome>;
  /** 집행 후 체결 대조(verify_order_filled). 생략 시 executor 결과 사용. */
  verifyFilled?: (intent: TradeIntent) => Promise<ExecOutcome>;
  /** 감사 로그 sink(상태전이). */
  audit?: (entry: { intentId: string; state: TradeState; note: string }) => void;
  /** 승인 단계 수(1 | 2). 기본 2(2단계). 대표 결정 시 1(단일 승인·2026-07-22). */
  stages?: 1 | 2;
}

/** 기본 executor — 집행 배선이 없으면 무조건 거부한다. 이 함수가 호출된다는 것은
 *  "승인은 다 받았는데 실행 배선이 없다"는 뜻이고, 그때는 집행하지 않는 게 정답. */
async function refuseExecutor(): Promise<never> {
  throw new Error('집행 배선 없음(executor 미주입) — 사람 명시 배선 필요. 에이전트/자동 집행 금지.');
}

function proposalPrompt(i: TradeIntent, g: GateOutcome): string {
  return `[매매 승인 1/2] ${i.side.toUpperCase()} ${i.qty} ${i.symbol}\n근거: ${i.reason}\n게이트: ${g.gate}${g.detail ? ` (${g.detail})` : ''}\n출처: ${i.source}\n승인하시겠습니까?`;
}
function confirmPrompt(i: TradeIntent): string {
  return `[매매 최종확인 2/2·집행 직전] ${i.side.toUpperCase()} ${i.qty} ${i.symbol}\n재검증 후 집행합니다. 최종 승인하시겠습니까?`;
}

/** intent를 상태머신으로 흘려보낸다. 집행(EXECUTED)은 게이트 CLEARED(제안 AND
 *  재검증) + 2 사람 승인 + executor 주입이 모두 있을 때만 도달한다. Never throws. */
export async function runTradeHitl(intent: TradeIntent, deps: TradeHitlDeps): Promise<TradeHitlResult> {
  const approvals: TradeHitlResult['approvals'] = [];
  const audit = (state: TradeState, note: string): void => deps.audit?.({ intentId: intent.id, state, note });
  const reject = (from: TradeState, reason: string, gate: string, reverify?: string): TradeHitlResult => {
    audit('REJECTED', `${from}: ${reason}`);
    return { intent, state: 'REJECTED', gate, approvals, executed: false, rejectReason: reason, ...(reverify ? { reverify } : {}) };
  };

  audit('PROPOSED', `${intent.side} ${intent.qty} ${intent.symbol}`);

  // 1. 게이트 검증 (fail-closed: CLEARED 아니면 거부).
  const g1 = await deps.verifyGate();
  if (g1.gate !== 'CLEARED') return reject('PROPOSED', `게이트 ${g1.gate}${g1.detail ? ` (${g1.detail})` : ''}`, g1.gate);
  audit('VERIFIED', 'gate CLEARED');

  // 2. HITL 1차 승인.
  const a1 = await deps.requestApproval(proposalPrompt(intent, g1), 1).catch((): ApprovalOutcome => ({ approved: false }));
  approvals.push({ stage: 1, ...a1 });
  if (!a1.approved) return reject('VERIFIED', '1차 승인 거부/타임아웃', g1.gate);
  audit('APPROVED_1', `via ${a1.channel ?? '?'}`);

  // 3. HITL 2차 승인 — stages===1 이면 스킵(단일 승인·대표 결정). 기본 2단계.
  if ((deps.stages ?? 2) >= 2) {
    const a2 = await deps.requestApproval(confirmPrompt(intent), 2).catch((): ApprovalOutcome => ({ approved: false }));
    approvals.push({ stage: 2, ...a2 });
    if (!a2.approved) return reject('APPROVED_1', '2차 승인 거부/타임아웃', g1.gate);
    audit('APPROVED_2', `via ${a2.channel ?? '?'}`);
  }

  // 4. 집행 직전 재검증 (두 승인 사이 시장 변동 가능).
  const g2 = await deps.verifyGate();
  if (g2.gate !== 'CLEARED') return reject('APPROVED_2', `재검증 ${g2.gate} — 집행 취소`, g1.gate, g2.gate);

  // 5. 집행 (executor 미주입 = 하드 거부).
  const exec = deps.executor ?? refuseExecutor;
  try {
    const r = await exec(intent);
    audit('EXECUTED', r.detail);
    // 6. 체결 대조.
    const vf = deps.verifyFilled ? await deps.verifyFilled(intent) : r;
    audit(vf.filled ? 'FILLED' : 'EXECUTED', vf.detail);
    return { intent, state: vf.filled ? 'FILLED' : 'EXECUTED', gate: g2.gate, reverify: g2.gate, approvals, executed: true, fill: vf.detail };
  } catch (e) {
    return reject('APPROVED_2', `집행 실패/미배선: ${e instanceof Error ? e.message : String(e)}`, g1.gate, g2.gate);
  }
}
