// 미션 생애주기 게이트 — 상태전이 단일 관문 (LG0·orchestration-framework RFC·2026-07-19)
//
// ★ RFC-orchestration-framework-lifecycle-governance LG0. updateMissionStatus 는 단일 함수인데 호출처가
//   10곳 산재(mission-engine·mission-lifecycle·se-nocturnal) — appendWorkingMemory 가 단일인데 산재였던
//   것([[RFC-mission-memory-state-unification-2026-07-19]] U2)과 **동형**. 이 게이트가 단일 관문: 전이 관측
//   (제1원칙 3박자) + 조율자 인지 기반. agent-loop-substrate 의 lifecycle 층.
//
// ★ 3박자(대표 지시): ①관측 mission.lifecycle.transition{from,to,reason,terminal}. ②자기인지 from→to·reason
//   ·terminal 노출로 "언제 무엇이 왜 전이했나". ③셀프힐 — 전이 로그가 힐 신호원(제1원칙: 관측이 힐 입력).
//   no-op(동일 상태 재전이)은 wiring smell 로 별도 관측. 조율자가 이 로그로 전 생애주기(생성·빌드·승인·완료)
//   트리거 사이클을 durable-poll 관장(LG1+). orchestrator 상속 정합 — 게이트는 전이 관문·전체문맥은 read-through.

import { TaskStore } from '../task-orchestrator/store.js';
import { updateMissionStatus, type MissionStatus } from './mission-registry.js';
import { debug } from '../debug/log.js';

/** 터미널 상태(완료·거부·취소) — 관측 terminal 플래그. */
const TERMINAL: ReadonlySet<string> = new Set(['done', 'rejected', 'cancelled']);

/**
 * ★ LG0 — 미션 생애주기 상태전이 단일 관문(U2 동형). updateMissionStatus 래핑 + 3박자 관측.
 * @param reason 전이 계기(approve/materialize/arm/reject/cancel/sweep-finite/nocturnal 등) — 자기인지 라벨.
 * fail-soft(관측 실패가 전이를 막지 않음). 실 전이는 여전히 updateMissionStatus(무회귀).
 */
export function missionLifecycleGate(store: TaskStore, id: string, to: MissionStatus, reason: string, now: Date = new Date()): void {
  let from = 'proposed';
  try { from = store.getMission(id)?.autopilot?.apmStatus ?? 'proposed'; } catch { /* fail-soft */ }
  updateMissionStatus(store, id, to, now);
  // ★ 제1원칙 3박자 — 관측(transition)·자기인지(from→to·reason)·셀프힐(로그가 힐 신호원). `elanous logs
  //   --category mission.lifecycle` 로 전 생애주기 회상. no-op 는 wiring smell(호출처 중복 전이) 자기인지.
  try {
    debug.log('mission.lifecycle', 'transition', { missionId: id, from, to, reason, terminal: TERMINAL.has(to) });
    if (from === to) debug.log('mission.lifecycle', 'transition-noop', { missionId: id, to, reason });
  } catch { /* fail-soft */ }
}
