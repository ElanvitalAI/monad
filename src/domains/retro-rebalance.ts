// ── 회고 리밸런싱 제안 + HITL (R2 · retro-rebalance · 2026-07-08) ─────────
//
// PeriodSummary(R0) + 승격 후보 → 리밸런싱·엔진교체 제안(순수). 대표 결정:
// 회고 리밸런싱/엔진교체는 **전 주기 사전 HITL 승인 필수**(자동 적용 없음).
// 제안 생성만 순수 · 실제 mandate 갱신은 승인 후 deps. [[ROADMAP-...]] R2.

import type { PeriodSummary } from './retro-aggregate.js';
import { combineChecks, type CheckResult, type CheckerVerdict } from './loop-contract.js';
import { createHash } from 'node:crypto';

/** 한 회고 틱당 제안 하드캡 — 과도한 리밸런싱 방지(Phase C stop). */
export const MAX_RETRO_DELTAS = 6;
export const MAX_ENGINE_SWAPS = 2;

export interface RebalanceDelta {
  target: string;              // 'aggressive fund' | 'main engine' | 전략명
  action: string;             // '편입 검토' | '비중 축소' | '엔진 교체 후보' 등
  reason: string;
}

export interface RebalanceProposal {
  id: string;                 // 제안 해시(멱등·감사)
  period: string;
  deltas: RebalanceDelta[];
  engineSwapCandidates: string[];
  proposalMd: string;         // renderReflectionMd(proposalMd) 주입용
  needsApproval: true;        // 항상 HITL(대표 결정)
}

/** 승격 후보 입력(백테스팅 promotions 조회 결과). */
export interface PromotionCandidate { expId: string; strategy: string; stage: string }

/** 회고 리밸런싱 제안(순수). 승격 후보·국면 전환·전략 우위를 근거로 delta 생성.
 *  제안일 뿐 — 적용은 HITL 승인 후(applyProposal). */
export function proposeRebalance(summary: PeriodSummary, candidates: PromotionCandidate[]): RebalanceProposal {
  const deltas: RebalanceDelta[] = [];
  const engineSwapCandidates: string[] = [];

  // 1) 페이퍼 통과(live-candidate) → aggressive fund 편입 검토.
  const liveCands = candidates.filter(c => c.stage === 'live-candidate' || c.stage === 'live-armed');
  for (const c of liveCands) {
    deltas.push({ target: 'aggressive fund', action: '편입 검토', reason: `${c.strategy} 페이퍼 통과(${c.expId})` });
  }

  // 2) 국면 전환 잦음 → 방어 강화 제안.
  if (summary.regime && summary.regime.transitions >= 3) {
    deltas.push({ target: 'main engine', action: '방어 비중 강화 검토', reason: `국면 전환 ${summary.regime.transitions}회(변동성↑)` });
  }

  // 3) 지속 우위 전략(CONFIRMED 다수) → 메인 엔진 교체 후보.
  for (const s of summary.backtest.topStrategies) {
    if (s.confirmed >= 3 && s.confirmed / Math.max(1, s.count) >= 0.5) {
      engineSwapCandidates.push(s.strategy);
      deltas.push({ target: 'main engine', action: '엔진 교체 후보', reason: `${s.strategy} CONFIRMED ${s.confirmed}/${s.count}(지속 우위)` });
    }
  }

  const proposalMd = deltas.length
    ? deltas.map(d => `- **${d.target}** — ${d.action} (${d.reason})`).join('\n')
    : '- (제안 없음 — 현 배분 유지)';

  const id = createHash('sha1').update(`${summary.window.period}|${summary.window.to}|${proposalMd}`).digest('hex').slice(0, 10);
  return { id, period: summary.window.period, deltas, engineSwapCandidates, proposalMd, needsApproval: true };
}

// ── 독립 sanity checker (Phase C · builder≠checker 대칭) ──
//
// proposeRebalance(builder)와 분리된 checker: 제안이 안전 범위 안인지 판정한다.
// 회고는 이미 HITL(대표 승인)이라 강제 차단은 아니지만, 원칙 2 대칭으로 제안을
// 독립 검증해 HITL 알림에 근거를 실어 comprehension-debt 를 줄인다(advisory).

/** 리밸런싱 제안 1건을 독립 검증(순수). combineChecks 로 AND 합성. */
export function checkProposal(proposal: RebalanceProposal): CheckerVerdict {
  const checks: CheckResult[] = [
    {
      name: 'delta-cap',
      passed: proposal.deltas.length <= MAX_RETRO_DELTAS,
      detail: `제안 ${proposal.deltas.length}건 (상한 ${MAX_RETRO_DELTAS})`,
    },
    {
      name: 'engine-swap-cap',
      passed: proposal.engineSwapCandidates.length <= MAX_ENGINE_SWAPS,
      detail: `엔진 교체 후보 ${proposal.engineSwapCandidates.length} (상한 ${MAX_ENGINE_SWAPS})`,
    },
    {
      name: 'hitl-invariant',
      passed: proposal.needsApproval === true,
      detail: proposal.needsApproval === true ? 'HITL 승인 필수 유지' : 'HITL 불변식 위반',
    },
  ];
  return combineChecks(checks);
}

// ── HITL 게이트(사전 승인 필수) ──

export interface ApplyDeps {
  /** 승인된 delta 를 mandate 에 반영(실제 갱신). 미승인 시 호출 안 함. */
  applyDelta: (d: RebalanceDelta) => void;
  /** 감사 기록. */
  audit?: (msg: string) => void;
}

export interface ApplyResult { applied: number; skipped: boolean; reason: string }

/** 제안 적용 — approved=true 일 때만 mandate 갱신(대표 사전 승인 필수).
 *  미승인이면 no-op(자동 적용 금지·대표 결정). */
export function applyProposal(proposal: RebalanceProposal, approved: boolean, deps: ApplyDeps): ApplyResult {
  if (!approved) {
    deps.audit?.(`회고 제안 ${proposal.id} 미승인 — 적용 안 함(HITL 대기)`);
    return { applied: 0, skipped: true, reason: '대표 승인 대기(사전 HITL 필수)' };
  }
  for (const d of proposal.deltas) deps.applyDelta(d);
  deps.audit?.(`회고 제안 ${proposal.id} 승인 적용 — ${proposal.deltas.length} delta`);
  return { applied: proposal.deltas.length, skipped: false, reason: '대표 승인 → 적용' };
}

/** HITL 알림 메시지(대표에게 승인 요청). */
export function hitlNotice(proposal: RebalanceProposal): string {
  return [
    `📋 ${proposal.period} 회고 리밸런싱 제안 (승인 필요·id ${proposal.id})`,
    proposal.proposalMd,
    '',
    '승인 시에만 적용됩니다(사전 HITL). 컨셉/범위 변경은 대표 결정.',
  ].join('\n');
}
