// ── 승인→멀티페이즈 executor (도메인 라우팅) — D6 ──────────────────────────
//
// HITL 승인된 멀티페이즈 미션을 도메인 executor 로 위임한다. 도메인이 "어떻게 실행하나"를
// 결정: coding/business = 페이즈를 dependsOn 존중으로 스테이징(root ready·나머지 blocked),
// investment = DRY(자동 실행 없음·집행은 mandate 게이트로만). 척추(approveMission)는 도메인
// 무관하게 이 함수만 호출한다.
//
// ★ 이 함수는 상태를 올바르게 세팅(스테이징)한다. ready 페이즈를 실제로 실행하는 자율
//   phase-driver(활성 디스패처·격리 worktree)는 별도 조각(arming 게이트) — 안전상 여기서
//   자동 실행을 강제하지 않는다. investment 는 스테이징조차 안 함(dry).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §5(executor)·umbrella §9.

import { getMission } from './mission-registry.js';
import { getDomainPack } from './domain/registry.js';
import { promotePhasesRespectingDeps } from './domain/phase-exec.js';
import type { TaskStore } from '../task-orchestrator/store.js';
import type { MissionExecutorResult } from './domain/types.js';

/** 승인된 미션을 도메인 executor 로 집행(스테이징). 도메인 executor 부재 시 기본=deps 존중 승격. */
export async function executeApprovedMission(
  missionId: string,
  ctx: { store: TaskStore; now: number },
): Promise<MissionExecutorResult> {
  const m = getMission(ctx.store, missionId);
  if (!m) return { ok: false, activated: 0, note: `미션 없음: ${missionId}` };
  const pack = getDomainPack(m.domain ?? 'coding');
  if (pack.executor) return pack.executor(missionId, ctx);
  // 도메인 executor 미배선 — 기본 안전 동작(deps 존중 스테이징).
  const activated = promotePhasesRespectingDeps(ctx.store, missionId, ctx.now);
  return { ok: true, activated, note: `${activated} root 페이즈 ready(기본 executor)` };
}
