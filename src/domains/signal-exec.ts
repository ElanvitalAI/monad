// ── 신호 집행 — 적응형 투자 오토파일럿 A5 (2026-07-11) ────────────────────────
//
// 게이트체인(A4a)이 허용한 confirmed adjust 신호를 **멱등**하게 집행한다. 운영 승격(§12.2):
// paper(시뮬) → canary(소액 재-arm) → live. 현 clean-slate 에선 mandate disarmed → **항상 paper**.
//
//   confirmed adjust → 게이트체인 판정 → (허용 시) 사이징 → paper 체결 시뮬 → 멱등 기록
//
// ★ 멱등성(§12.2 게이트체인 마지막 단계): exec_at 마커로 같은 신호 재집행 방지(크론 재실행 안전).
// ★ 안전: paper 는 실주문 0(시뮬·기록만). live 는 mandate.armed+live + 브로커 seam(liveExec)
//   둘 다 있어야 — 재-arm 전엔 도달 불가. seam 미주입이면 live 모드여도 무집행(fail-closed).
//
// 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §5·§6·§12.2·§12.6(A5).

import type { Signal } from './signal-pool.js';
import { SignalPool } from './signal-pool.js';
import { evaluateGateChain, classifyActionStructured, type GateChainContext, type ActionClassifier, type ActionKind } from './mandate-gate-chain.js';
import type { TradeMandate } from './trade-mandate.js';
import { debug } from '../debug/log.js';

export type ExecMode = 'paper' | 'live';

/** mandate 상태 → 집행 모드. armed+live 여야 실주문(live), 아니면 paper 시뮬. */
export function resolveExecMode(mandate: TradeMandate): ExecMode {
  return mandate.armed && mandate.live ? 'live' : 'paper';
}

export interface Fill {
  symbol: string; side: 'buy' | 'sell'; qty: number;
  priceKrw: number; notionalKrw: number;
}

/** 사이징 — 명목 금액(notionalKrw)을 시세로 나눠 정수 수량. 시세 없음/0수량이면 null. */
export function sizeIntent(
  symbol: string, side: 'buy' | 'sell', priceKrw: number | null, notionalKrw: number,
): Fill | null {
  if (!priceKrw || priceKrw <= 0) return null;
  const qty = Math.floor(notionalKrw / priceKrw);
  if (qty <= 0) return null;
  return { symbol, side, qty, priceKrw, notionalKrw: qty * priceKrw };
}

/** 게이트체인 컨텍스트(신호별 dedupCount·attractiveness 는 runExec 이 계산·조회). */
export type ExecGateCtx = Omit<GateChainContext, 'mandate' | 'dedupCount' | 'attractiveness'>;

export interface ExecDeps {
  mandate: TradeMandate;
  gateCtx: ExecGateCtx;
  /** 시세(paper 사이징·주입). 없으면 사이징 실패 → refused. */
  priceOf: (symbol: string) => number | null;
  /** 종목 매력도(B2·게이트체인 신규 축·주입). null=미스코어(fail-soft). */
  attractivenessOf?: (symbol: string) => { signal: 'BUY' | 'HOLD' | 'SELL' } | null;
  /** paper 명목 금액(기본 100만). */
  notionalKrw?: number;
  now?: () => string;
  limit?: number;
  /** live 브로커 seam(A5c·기본 미주입 → live 모드여도 무집행·fail-closed). */
  liveExec?: (fill: Fill, signal: Signal) => Promise<{ ok: boolean; detail: string }>;
  /**
   * 비구조 신호(proposedAction 불명)의 방향 LLM 분류 seam. 미주입/실패=보호 기본.
   * 구조화 신호(price-guard 등)는 호출 안 함(결정론이 authoritative·안전).
   */
  resolveAction?: ActionClassifier;
}

export interface ExecItem { eventId: string; mode: ExecMode; status: string; detail: string }
export interface RunExecResult {
  mode: ExecMode;
  processed: number; filled: number; refused: number;
  items: ExecItem[];
}

/** 미집행 confirmed adjust 신호를 게이트체인 통과분만 멱등 집행(paper 기본). */
export async function runExec(pool: SignalPool, deps: ExecDeps): Promise<RunExecResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const notional = deps.notionalKrw ?? 1_000_000;
  const mode = resolveExecMode(deps.mandate);
  const targets = pool.listPendingExec(deps.limit ?? 50);

  const items: ExecItem[] = [];
  let filled = 0; let refused = 0;
  const record = (eventId: string, status: string, detail: string): void => {
    pool.markExec(eventId, { mode, status, detail, at: now() });
    items.push({ eventId, mode, status, detail });
  };

  for (const s of targets) {
    const dedupCount = s.dedupGroup ? pool.dedupGroupCount(s.dedupGroup) : 1;
    const attractiveness = s.asset && deps.attractivenessOf ? deps.attractivenessOf(s.asset) : null;
    // ★ 방향(매수/매도) 결정 — 안전-critical. 구조화 필드 우선(결정론). 불명(ambiguous)이고
    //   LLM seam 있으면 LLM 분류, 실패/부재는 보호 기본(자본보존). gate2Reason 자유텍스트로
    //   방향 뒤집는 사고(2026-07-15 실매수 오발주) 재발 방지.
    const structured = classifyActionStructured(s);
    let action: ActionKind;
    let actionSource: string;
    if (structured !== 'ambiguous') { action = structured; actionSource = 'structured'; }
    else if (deps.resolveAction) { action = (await deps.resolveAction(s)) ?? 'protection'; actionSource = 'llm'; }
    else { action = 'protection'; actionSource = 'default-protection'; }
    // 집행 방향 관측 — logs.db 에 남겨 오분류가 다시 조용히 지나가지 못하게(대표 지시·관측 부실 근본).
    debug.log('signal.exec', 'direction', {
      asset: s.asset ?? null, action, side: action === 'protection' ? 'sell' : 'buy',
      source: actionSource, mode, proposedAction: s.proposedAction ?? null,
      recommendation: s.recommendation ?? null, eventId: s.eventId,
    });
    const verdict = evaluateGateChain(s, { ...deps.gateCtx, mandate: deps.mandate, dedupCount, attractiveness, actionOverride: action });
    if (!verdict.permitted) {
      const status = verdict.mandateVerdict?.needsReapproval ? 'reapproval'
        : verdict.blockedGate === 'mandate' ? 'refused' : 'blocked';
      record(s.eventId, status, `${verdict.blockedGate ?? '-'}: ${verdict.reason}`);
      refused += 1; continue;
    }
    // 허용 — 사이징(asset 은 게이트체인 no-asset 게이트가 보장).
    const side = verdict.action === 'protection' ? 'sell' : 'buy';
    const fill = sizeIntent(s.asset!, side, deps.priceOf(s.asset!), notional);
    if (!fill) { record(s.eventId, 'refused', `사이징 실패(시세 없음·${s.asset})`); refused += 1; continue; }

    if (mode === 'paper') {
      record(s.eventId, 'paper-filled', `PAPER ${side} ${fill.qty} ${s.asset} @${fill.priceKrw} (₩${fill.notionalKrw})`);
      filled += 1;
    } else {
      // live — 브로커 seam(A5c). 미주입이면 재-arm 됐어도 무집행(fail-closed).
      if (!deps.liveExec) { record(s.eventId, 'refused', 'live 브로커 seam 미배선(A5c·무집행)'); refused += 1; continue; }
      const r = await deps.liveExec(fill, s);
      const detail = r.ok
        ? `${side} ${fill.qty} ${s.asset} @${fill.priceKrw} (intended sizing price; not actual execution price) ${r.detail}`
        : r.detail;
      record(s.eventId, r.ok ? 'live-filled' : 'refused', detail);
      if (r.ok) filled += 1; else refused += 1;
    }
  }
  return { mode, processed: targets.length, filled, refused, items };
}
