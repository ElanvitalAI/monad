// ── 미션 아크 A6-b — 과대골 → 성숙도 단계 후속 미션 ────────────────────────────
// RFC-mission-arcs §8b · PLAN-mission-arc-a6-goal-altitude-anti-inflation §5.
//
// 골-고도 반-인플레이션(A6)의 (A) 미션 과대(over-scope) 대응. A7-L2 preflight 가 **아크**를
// over_scope 로 판정하듯, A6-b 는 **미션 전체**가 성숙도 여러 단계를 욱여넣었는지 본다:
//   과대면 그대로 분해하지 말고 → "지금 = 성숙도 1단계(핵심 아크만) · 나머지 = 후속 미션" 역제안.
//
// ★ 자율경계(대표) — 자동 분리 **절대 금지**. 검출·제안은 HITL 표면(prepare 카드·CLI)에만. apply 는
//   명시 트리거(대표)로만 실행하며 후속 미션은 proposed(대기)로 착지(자동 실행 없음). 비파괴 —
//   apply 는 현 미션(M1)의 아크를 건드리지 않는다(M1 트리밍은 기존 skip/arc-revise 로).

import type { TaskStore } from '../task-orchestrator/store.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import type { Tier } from './triage.js';
import { createMission, attachChildMission } from './mission-registry.js';
import { recordOpsEventSafe } from '../domains/ops-log.js';
import { debug } from '../debug/log.js';

/** 멀티아크 고려 최소 아크 수 — 이 미만이면 과대 아님(과계층화 방지·보수적). */
export const MATURITY_MIN_ARCS = 3;

export interface MaturityFollowup {
  /** 후속 미션 이름(아크 이름 재사용). */
  name: string;
  /** 후속 미션 골이 될 아크 intent. */
  intent: string;
  /** 이 후속에 속한 아크 arcId[]. */
  arcIds: string[];
}

export interface MaturityProposal {
  oversized: boolean;
  estArcs: number;
  estPhases: number;
  reason: string;
  /** 성숙도 1단계 — 지금 미션이 유지할 핵심 아크(선행 없는 root). */
  core: { name: string; arcIds: string[] };
  /** 성숙도 2+단계 — 후속 미션 후보(선행 있는 아크). */
  followups: MaturityFollowup[];
}

/** 과대 판정(순수) — tier heavy AND 아크≥3, 또는 over_scope preflight 아크가 있고 아크≥2. */
export function detectMaturityOverScope(
  arcs: readonly MissionArc[] | undefined,
  tier: Tier | undefined,
): { oversized: boolean; reason: string; estArcs: number; estPhases: number } {
  const list = arcs ?? [];
  const estArcs = list.length;
  const estPhases = list.reduce((n, a) => n + a.phaseIds.length, 0);
  const overScopeFlagged = list.filter((a) => a.preflightVerdict?.verdict === 'over_scope').length;
  const heavyMulti = tier === 'heavy' && estArcs >= MATURITY_MIN_ARCS;
  const flaggedMulti = overScopeFlagged >= 1 && estArcs >= 2;
  const oversized = heavyMulti || flaggedMulti;
  const reason = !oversized
    ? `과대 아님(아크 ${estArcs}·tier ${tier ?? '?'})`
    : heavyMulti
      ? `과대 — heavy·아크 ${estArcs}개(≥${MATURITY_MIN_ARCS})·페이즈 ${estPhases}`
      : `과대 — over_scope 판정 아크 ${overScopeFlagged}건(아크 ${estArcs})`;
  return { oversized, reason, estArcs, estPhases };
}

/** 성숙도 분리 제안 구성(순수·비파괴). core=선행 없는 아크(1단계), followups=선행 있는 아크(2+단계). */
export function buildMaturityProposal(
  arcs: readonly MissionArc[] | undefined,
  tier: Tier | undefined,
): MaturityProposal {
  const list = arcs ?? [];
  const det = detectMaturityOverScope(list, tier);
  const roots = list.filter((a) => a.dependsOnArcs.length === 0);
  const nonRoots = list.filter((a) => a.dependsOnArcs.length > 0);
  const core = roots.length > 0
    ? { name: roots.map((a) => a.name).join(' + '), arcIds: roots.map((a) => a.arcId) }
    : { name: list[0]?.name ?? '(없음)', arcIds: list[0] ? [list[0].arcId] : [] };
  const followups: MaturityFollowup[] = nonRoots.map((a) => ({ name: a.name, intent: a.intent, arcIds: [a.arcId] }));
  return { ...det, core, followups };
}

/** HITL 카드/알림용 요약(대표 승인 텍스트). */
export function formatMaturityProposal(p: MaturityProposal): string {
  if (!p.oversized) return '';
  const lines = [
    `⚠️ 과대 미션 — 성숙도 분리 권장 (${p.reason})`,
    `  핵심(지금·M1): ${p.core.name}`,
  ];
  p.followups.forEach((f, i) => lines.push(`  후속 M${i + 2}: ${f.name} — ${f.intent.slice(0, 60)}`));
  lines.push(`  → 승인 시 후속 ${p.followups.length}개를 proposed 미션으로 분리(M1 종속·자동 실행 없음)`);
  return lines.join('\n');
}

export interface MaturitySplitResult {
  ok: boolean;
  reason: string;
  created: string[];
  proposal?: MaturityProposal;
}

/**
 * 성숙도 분리 집행(HITL 트리거) — 후속 아크를 proposed 후속 미션으로 생성하고 parent-child 로 연결.
 * 비파괴(M1 아크 불변). 자동 실행 없음(proposed 착지). 과대 아니면 no-op.
 */
export function applyMaturitySplit(store: TaskStore, missionId: string, now: Date = new Date()): MaturitySplitResult {
  const m = store.getMission(missionId);
  if (!m) return { ok: false, reason: `미션 없음: ${missionId}`, created: [] };
  const arcs = m.autopilot?.arcs;
  const tier = m.autopilot?.tier as Tier | undefined;
  const proposal = buildMaturityProposal(arcs, tier);
  if (!proposal.oversized) return { ok: false, reason: proposal.reason, created: [], proposal };
  if (proposal.followups.length === 0) return { ok: false, reason: '후속 후보 아크 없음(전부 root)', created: [], proposal };
  const created: string[] = [];
  for (const fu of proposal.followups) {
    const goal = `[성숙도 후속] ${fu.name} — ${fu.intent}`;
    const child = createMission(store, {
      goal, source: 'manual', status: 'proposed', now,
      triage: { tier: 'heavy', rationale: `성숙도 분리(부모 ${missionId})` },
    });
    attachChildMission(store, missionId, child.id, now);
    created.push(child.id);
  }
  debug.log('mission.scope', 'split', { missionId, created: created.length, followups: proposal.followups.map((f) => f.name) });
  recordOpsEventSafe({
    entityType: 'mission', entityId: missionId, event: 'mission_linked',
    rationale: `성숙도 분리 — 후속 ${created.length}개 proposed 생성(M1 종속)`,
    actor: 'manual', refs: { direction: 'maturity_split', created, estArcs: proposal.estArcs },
    now: () => now.toISOString(),
  });
  return { ok: true, reason: proposal.reason, created, proposal };
}
