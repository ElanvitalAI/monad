// 미션 solve 루프 — 지정된 코딩 미션들을 순차 자율해결 (D 자율화 · 2026-07-20)
//
// DESIGN-cross-surface-autonomy-membrane §8. solveMissionViaHarness(단건)를 여러 미션에
// 순차 적용하는 루프. "미션 폴러→solve"의 안전 핵심 — 단, **백그라운드 자동발굴이 아니라
// 명시된 mission id 목록**만 푼다(대표가 무엇을 풀지 지정·방화벽·[[feedback_signal_wiring_via_mission]]).
//
// ★★ 미션 DB 방화벽: readMission(=getMission) 만 쓴다 — 상태전이/생성/삭제 write 0. solve 도
//   store 없는 solveMissionViaHarness 라 구조적으로 DB 무접촉. PR-open 은 하니스 안 fail-closed HITL.
//
// ★ 제1원칙: 미션별 결과(solved/refused/error) observe(harness.mission-loop) — 어떤 미션을
//   왜 못 풀었나 자기인지. 한 미션 실패가 다음 미션을 막지 않게 기본 continue(stopOnError=false).

import type { MissionRow } from '../autopilot/mission-registry.js';
import type { SelfImplementSeams } from '../self-implement/orchestrator.js';
import type { SurfaceUx } from '../agent/surface-ux/types.js';
import type { AutoDrive } from './staged-harness.js';
import { solveMissionViaHarness, isSolveRefusal, type SolveMissionInput, type SolveMissionResult } from './mission-harness.js';
import { debug } from '../debug/log.js';

export interface MissionSolveOutcome {
  missionId: string;
  status: 'solved' | 'not-solved' | 'refused' | 'not-found' | 'error';
  /** 하니스 terminal(solve 도달 시) 또는 거부 사유. */
  terminal?: string;
  detail?: string;
}

export interface MissionSolveLoopInput {
  /** 풀 미션 id 목록 — **대표가 명시**(백그라운드 자동발굴 아님·방화벽). */
  missionIds: readonly string[];
  /** 미션 read(기본 getMission wrapper·read-only). null=미존재. */
  readMission: (id: string) => MissionRow | null;
  /** 재사용 self-implement seam. */
  seams: SelfImplementSeams;
  /** 막 — 진행/승인이 이 서피스로. */
  ux: SurfaceUx;
  /** autoDrive 정책(기본 safe). */
  autoDrive?: AutoDrive;
  /** 첫 error 에서 중단할지(기본 false — 계속). */
  stopOnError?: boolean;
  /** solve seam(기본 solveMissionViaHarness). 테스트/대체용. */
  solve?: (input: SolveMissionInput) => Promise<SolveMissionResult>;
}

/**
 * 지정 미션들을 순차 solve. read-only(미션 DB write 0)·미션별 결과 리포트 반환.
 * 미존재/거부/에러는 스킵하고 계속(stopOnError 아니면). 전 경로 관측.
 */
export async function runMissionSolveLoop(input: MissionSolveLoopInput): Promise<MissionSolveOutcome[]> {
  const { missionIds, readMission, seams, ux, autoDrive = 'safe', stopOnError = false } = input;
  const solve = input.solve ?? solveMissionViaHarness;
  const results: MissionSolveOutcome[] = [];

  debug.log('harness.mission-loop', 'start', { count: missionIds.length, autoDrive, surface: ux.surface });

  for (const missionId of missionIds) {
    const mission = readMission(missionId);
    if (!mission) {
      debug.log('harness.mission-loop', 'not-found', { missionId });
      results.push({ missionId, status: 'not-found', detail: '미션 미존재' });
      continue;
    }
    try {
      const r = await solve({ mission, seams, ux, autoDrive });
      if (isSolveRefusal(r)) {
        debug.log('harness.mission-loop', 'refused', { missionId, refused: r.refused });
        results.push({ missionId, status: 'refused', detail: r.detail });
      } else {
        debug.log('harness.mission-loop', 'solved', { missionId, terminal: r.terminal, ok: r.ok });
        results.push({ missionId, status: r.ok ? 'solved' : 'not-solved', terminal: r.terminal, ...(r.detail ? { detail: r.detail } : {}) });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      debug.log('harness.mission-loop', 'error', { missionId, detail }, { level: 'error' });
      results.push({ missionId, status: 'error', detail });
      if (stopOnError) break;
    }
  }

  const solved = results.filter((r) => r.status === 'solved').length;
  debug.log('harness.mission-loop', 'done', { total: results.length, solved });
  return results;
}
