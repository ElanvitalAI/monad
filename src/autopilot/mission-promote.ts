// ── 미션 promote — 테스트 인스턴스 → 운영 스토어 캐스케이드 (ISO·LF7 상향 · 2026-07-14) ──
//
// 대표 결정: 셋업(골 던지기·외부조사·분해·플랜)을 격리 테스트에서 다 한 뒤, 완성된
// 미션 + 파생 태스크 + 플랜을 통째로 운영으로 이관한다. config 의 `monad config promote`
// (테스트→운영 필드 단위 전파·ISO-4)와 동형 — 격리는 유지하되 명시적 상향 통로를 연다.
//
// 안전 모델(비협상 · config PROMOTE_DENYLIST 정신):
//   • notify origin(테스트 텔레그램 chatId/botId)은 별도 스토어(mission-origin)라 애초에
//     복사 안 함 → 운영 미션은 origin 부재 → report 폴백. (미션 오발송 사건 재발 원천 차단.)
//   • executions/events(테스트 런타임 이력)는 다른 테이블 — 미복사(운영 이력 무오염).
//   • materializeSpec/cron 은 스트립 → 운영에서 HITL 재materialize(테스트 크론 안 넘김).
//   • status → planning · apmStatus → proposed 로 착지(운영 자기 손 재승인 = 사람 게이트).
//   • 물리 격리는 유지 — 이 통로는 "복사+재소유"지 스토어 공유가 아니다.

import { TaskStore } from '../task-orchestrator/store.js';
import type { Mission, MissionAutopilot } from '../task-orchestrator/mission.js';
import type { Task } from '../task-orchestrator/types.js';
// 인스턴스명 유도는 로그·세션과 공유(instance-identity SSoT · 중복 제거).
export { instanceNameForStateDir } from '../instance-identity.js';

/** autopilot 메타에서 스트립할 필드 — 테스트 런타임/구체화/계보(단독 promote 범위 밖). */
export const PROMOTE_STRIPPED_AUTOPILOT: readonly (keyof MissionAutopilot)[] = [
  'materializeSpec',                    // cron/command — 운영서 HITL 재materialize
  'runIds',                             // 테스트 실행 세션 id
  'rerunGeneration', 'rerunHistory',    // 테스트 재실행 이력
  'paused',                             // 테스트 일시정지 플래그
  'childMissionIds', 'parentMissionId', // 계보 fan-in — 단독 promote 범위 밖(coordinator 는 후속)
];

export interface PromotedBundle {
  mission: Mission;
  tasks: Task[];
  /** 실제 스트립된 autopilot 필드(있던 것만). */
  stripped: string[];
  /** dest 에 같은 id 가 이미 있나(재-promote — 덮어씀). */
  exists: boolean;
}

/** source 스토어에서 미션(+태스크)을 읽어 운영 착지용으로 변환(스트립·상태 리셋·provenance).
 *  순수 — 어느 스토어에도 쓰지 않는다. 미션 없으면 null. */
export function buildPromotedMission(
  source: TaskStore, dest: TaskStore, missionId: string,
  opts: { withTasks: boolean; fromInstance: string; now: number },
): PromotedBundle | null {
  const m = source.getMission(missionId);
  if (!m) return null;

  const stripped: string[] = [];
  const ap: Record<string, unknown> = { ...(m.autopilot ?? {}) };
  for (const f of PROMOTE_STRIPPED_AUTOPILOT) {
    if (ap[f] !== undefined) { delete ap[f]; stripped.push(f); }
  }
  ap.apmStatus = 'proposed';                    // 운영서 재승인(사람 게이트)
  // origin(source 축·human-intent/discovery)은 provenance 라 보존 — notify chatId 와 무관.
  const autopilot = { ...(ap as unknown as MissionAutopilot), origin: m.autopilot?.origin ?? 'human-intent' };

  const promoted: Mission = {
    ...m,
    status: 'planning',
    closedAt: undefined,
    updatedAt: opts.now,
    autopilot,
    notes: [...m.notes, `promoted from ${opts.fromInstance} at ${new Date(opts.now).toISOString()}`],
  };

  const tasks: Task[] = [];
  if (opts.withTasks) {
    // 두 연결(mission_id + goal_slug=apm_id) 모두 잡는다 — heavy 멀티페이즈 분해는
    // goal_slug 만 심어서 mission_id 조회로는 페이즈를 0개로 놓쳤다(2026-07-14 실측).
    for (const t of source.listTasksForMissionAnyLink(missionId)) {
      // 런타임 상태 리셋 — 운영에서 새로 실행(테스트 실행 흔적 안 가져감·spec 은 보존).
      tasks.push({
        ...t,
        status: 'backlog',
        attempt: 0,
        lastExecutionId: undefined,
        schedulerJobId: undefined,
        reviewVerdicts: undefined,
        updatedAt: opts.now,
      });
    }
  }

  return { mission: promoted, tasks, stripped, exists: dest.getMission(missionId) !== null };
}

/** dest(운영) 스토어에 promote 번들을 upsert. saveMission/saveTask 는 REPLACE 의미(재-promote 안전). */
export function applyPromotedMission(dest: TaskStore, bundle: PromotedBundle): void {
  dest.saveMission(bundle.mission);
  for (const t of bundle.tasks) dest.saveTask(t);
}
