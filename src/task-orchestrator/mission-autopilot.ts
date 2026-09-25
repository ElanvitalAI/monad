/**
 * apm Mission → TOX Mission 흡수 매퍼 (Mission Fabric 통합 U1).
 *
 * Origin: 내부 문서 `DESIGN-mission-fabric-unification-2026-07-09` §4 (흡수)
 *
 * 병렬로 존재하던 `autopilot_missions`(apm) row 를 TOX Mission 위로 옮기는
 * **순수 함수**들. task-orchestrator 는 하위 fabric 이므로 여기서 src/autopilot
 * 을 import 하지 않는다 — apm row 의 구조적 부분집합({@link ApmMissionSnapshot})
 * 만 받아 {@link MissionInit} 로 변환한다. 실제 마이그레이션 배선(레지스트리·
 * tool·API·PWA 재배선)은 후속 U1b~ 에서 이 매퍼를 소비한다.
 */

import type { MissionAutopilot, MissionInit, MissionStatus } from './mission.js';

/**
 * apm 자율 lifecycle 상태(proposed·armed·running·done·failed·disarmed)를
 * TOX 5-state canonical lifecycle 로 매핑.
 *
 * arming/mandate 축(proposed/armed/disarmed)은 아직 "실행 전"이므로 planning 에
 * 머문다 — 실제 active 진입은 materialize 후 running 으로 표현. 원래 apm 상태는
 * {@link MissionAutopilot.apmStatus} 에 보존되어 게이트 판단에 계속 쓰인다.
 */
export function apmStatusToMissionStatus(apmStatus: string | null | undefined): MissionStatus {
  switch (apmStatus) {
    case 'running':
      return 'active';
    case 'done':
      return 'completed';
    case 'failed':
      return 'cancelled';
    case 'rejected':
      return 'cancelled'; // 보류(대표 거절) — record 유지·TOX 상 종결. dedup/recall 은 apmStatus 로 제외.
    case 'proposed':
    case 'armed':
    case 'disarmed':
    default:
      return 'planning';
  }
}

/**
 * apm Mission 스냅샷 — `autopilot_missions` row 의 구조적 부분집합.
 * (src/autopilot 를 import 하지 않기 위한 로컬 계약.)
 */
export interface ApmMissionSnapshot {
  /** apm_<yyyymmddHHmm>_<slug>_<hash6> — 안정 lineage 키. */
  id: string;
  goal: string;
  // 'human-intent'(구 'intake' 리네임·사람 포착) — 'intake' 는 레거시 저장값 read 호환용 유지.
  source: 'human-intent' | 'intake' | 'discovery' | 'repo-watch' | 'manual';
  executionModel?: string | null;
  /** 도메인(WHAT 축·coding/investment/research/general) — D1. */
  domain?: string | null;
  tier?: string | null;
  engine?: string | null;
  rationale?: string | null;
  confidence?: string | null;
  /** apm status (proposed·armed·running·done·failed·disarmed). */
  status?: string | null;
  runIds?: readonly string[] | null;
  materializeSpec?: { command?: string; cron?: string; prompt?: string } | null;
}

/**
 * apm Mission 스냅샷 → TOX {@link MissionInit}. 순수(IO 없음).
 *
 * - `goalSlug` = apmId: 계보 fan-in(schedule_registry.autopilot_id·
 *   tox_tasks.goal_slug·surface_events.refs)이 apmId 로 조인하므로 보존한다.
 * - autopilot 메타 전부 {@link MissionAutopilot} blob 으로 흡수.
 */
export function apmSnapshotToMissionInit(snap: ApmMissionSnapshot): MissionInit {
  const runIds = snap.runIds && snap.runIds.length > 0 ? [...snap.runIds] : undefined;
  const autopilot: MissionAutopilot = {
    apmId: snap.id,
    origin: snap.source,
    executionModel: snap.executionModel ?? undefined,
    domain: snap.domain ?? undefined,
    tier: snap.tier ?? undefined,
    engine: snap.engine ?? undefined,
    rationale: snap.rationale ?? undefined,
    confidence: snap.confidence ?? undefined,
    apmStatus: snap.status ?? undefined,
    materializeSpec: snap.materializeSpec ?? undefined,
    runIds,
  };
  const title = (snap.goal.trim().slice(0, 80) || snap.id).slice(0, 80);
  return {
    title,
    intent: snap.goal.slice(0, 1000),
    source: { kind: 'manual', raw: snap.goal },
    status: apmStatusToMissionStatus(snap.status),
    goalSlug: snap.id,
    autopilot,
  };
}

/** 이 Mission 이 PFC Layer2 자율 Mission 인가 (autopilot 메타 존재). */
export function isAutopilotMission(m: { autopilot?: MissionAutopilot }): boolean {
  return m.autopilot !== undefined;
}
