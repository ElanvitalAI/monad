// ── 페이즈 스테이징 (dependsOn 존중) — D6 ─────────────────────────────────
//
// 승인 후 멀티페이즈 미션의 backlog 페이즈를 **실행 가능 상태로 올바르게 스테이징**한다:
// 의존 없는 root 만 ready, 나머지는 blocked(선행 페이즈 done 시 데몬 phase-driver 가
// cascade 승격). 기존 approveMission 은 dependsOn 을 무시하고 전부 ready 로 올렸다(버그) —
// 이러면 phase1 이 phase0 완료 전에 실행될 수 있다. 이 함수가 순서를 보장한다.
//
// leaf 모듈(registry/pack 을 import 하지 않음) — 순환 회피. 도메인 pack executor 가 소비.
//
// ★ 자율 phase-driver(ready 페이즈를 실제로 실행)는 별도(활성 디스패처 배선·arming 게이트).
//   이 함수는 상태만 올바르게 세팅한다(스테이징) — 안전(자동 실행 강제 안 함).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §4.1·§5(executor).

import type { TaskStore } from '../../task-orchestrator/store.js';

/** backlog 페이즈를 dependsOn 존중으로 스테이징 — root→ready, 나머지→blocked. ready 수 반환. */
export function promotePhasesRespectingDeps(store: TaskStore, missionId: string, now: number): number {
  const backlog = store.listTasks({ goalSlug: missionId }).filter((t) => t.status === 'backlog');
  let activated = 0;
  for (const t of backlog) {
    const isRoot = (t.dependsOn ?? []).length === 0;
    store.saveTask({ ...t, status: isRoot ? 'ready' : 'blocked', updatedAt: now });
    if (isRoot) activated += 1;
  }
  return activated;
}
