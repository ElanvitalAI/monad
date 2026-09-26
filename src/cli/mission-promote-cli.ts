// ── `elanous autopilot promote` CLI — 테스트 인스턴스 미션 → 운영 캐스케이드 (2026-07-14) ──
//
// config 의 `elanous config promote` 와 동형 UX: dry-run 기본(무엇이 이관/스트립되는지 표시),
// 적용은 --yes. cross-store(테스트 tasks.db 읽기 · 운영 tasks.db 쓰기)라 autopilot 단일-스토어
// 파이프라인(runAutopilot)이 아니라 여기서 직접 두 스토어를 연다.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TaskStore } from '../task-orchestrator/store.js';
import { prodConfigDir, findRepoRootUp } from './config-test-sync.js';
import { buildPromotedMission, applyPromotedMission, instanceNameForStateDir } from '../autopilot/mission-promote.js';

export interface MissionPromoteOpts {
  /** 소스 테스트 state 루트(기본 <repoRoot>/.elanous-test). */
  from?: string;
  /** 레포 루트 override(기본 cwd 상향 탐색). */
  repo?: string;
  /** 파생 태스크도 이관(기본 미션 row + 플랜만). */
  withTasks?: boolean;
  /** 적용(기본 dry-run). */
  yes?: boolean;
}

/** `elanous autopilot promote <missionId> [--from <dir>] [--with-tasks] [--yes]`. 반환 = exit code. */
export function runMissionPromote(missionId: string, opts: MissionPromoteOpts): number {
  const repoRoot = opts.repo ?? findRepoRootUp(process.cwd());
  const sourceDir = opts.from ?? (repoRoot ? join(repoRoot, '.elanous-test') : undefined);
  if (!sourceDir) {
    console.error('elanous autopilot promote: 레포 루트(.git) 미발견 — --from <testStateDir> 또는 --repo <path>');
    return 1;
  }
  const sourceDbPath = join(sourceDir, 'tasks', 'tasks.db');
  const destDbPath = join(prodConfigDir(), 'tasks', 'tasks.db');
  if (!existsSync(sourceDbPath)) {
    console.error(`elanous autopilot promote: 소스 미션 스토어 없음 (${sourceDbPath})`);
    return 1;
  }
  if (sourceDbPath === destDbPath) {
    console.error('elanous autopilot promote: 소스와 운영 스토어가 동일 — 테스트 인스턴스에서 실행하거나 --from 지정');
    return 1;
  }

  const source = new TaskStore({ path: sourceDbPath });
  const dest = new TaskStore({ path: destDbPath });
  try {
    const fromInstance = instanceNameForStateDir(sourceDir);
    const bundle = buildPromotedMission(source, dest, missionId, {
      withTasks: !!opts.withTasks, fromInstance, now: Date.now(),
    });
    if (!bundle) {
      console.error(`elanous autopilot promote: 미션 없음(소스 ${fromInstance}): ${missionId}`);
      return 1;
    }

    console.log(`promote ${missionId}`);
    console.log(`  from:   ${fromInstance}  (${sourceDbPath})`);
    console.log(`  to:     prod  (${destDbPath})`);
    console.log(`  goal:   ${bundle.mission.intent ?? bundle.mission.title}`.slice(0, 100));
    console.log(`  착지:   status=planning · apmStatus=proposed (운영서 arm/materialize 는 HITL)`);
    console.log(`  tasks:  ${bundle.tasks.length}${opts.withTasks ? ' 이관' : ' (--with-tasks 로 포함)'}`);
    console.log(`  strip:  ${bundle.stripped.join(', ') || '(없음)'}  · origin(notify)/executions/events 미복사`);
    if (bundle.exists) console.log('  ⚠️  운영에 같은 id 존재 — 덮어씀(재-promote)');
    if (!opts.yes) {
      console.log('dry-run — 적용하려면 --yes');
      return 0;
    }
    applyPromotedMission(dest, bundle);
    console.log(`적용 완료 → 운영 스토어에 proposed 착지. 운영에서 'elanous autopilot list' 로 확인 후 arm/materialize.`);
    return 0;
  } catch (e) {
    console.error(`elanous autopilot promote 실패: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    source.close();
    dest.close();
  }
}
