#!/usr/bin/env bun
// ── walker 페이즈 미션 worktree 격리 dogfood (#4824 flip-on 前 실증 · 2026-07-21) ──
//
// 목적: autopilot.missionWorktree=true 에서 walker(operational) 페이즈가 미션 worktree 로 격리되어
// 실행되고, walker 산출이 worktree 에만 남고 main 트리는 무오염임을 라이브 실증한다. #4824 는 메커니즘만
// (gated OFF) — 이 dogfood 로 worktree created/dispose + main 무오염을 확인한 뒤 운영 flip-on 판단.
//
// 게이트(scripts/run-mission.ts:510-512): autopilot.missionWorktree===true AND 미션에 subagent surface
// task 존재(hasSub). 아래 페이즈는 surface.kind='subagent' 라 hasSub 충족. 제목 "조사" → classifyPhaseKind
// operational → walker 라우팅. description 이 마커 파일 write 를 요구 → walker 가 worktree 안에 write.
//
// 사용(전부 테스트 스코프 — 운영 무접촉):
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-walker-worktree-isolation.ts        # 미션 생성 → id 출력
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/run-mission.ts <id> --config-dir $PWD/.elanous-test
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-walker-worktree-isolation.ts --cleanup <id>
//
// 선행: .elanous-test/config.json 에 autopilot.missionWorktree=true · autopilot.budget.walker=[120000](write 여유).
// 관측: elanous logs --test --category mission.exec.worktree (created) · git status(main 무오염) · git worktree list(dispose).

// ★ config-dir 격리 필수 — tasks.db 는 getElanousConfigDir(config-dir) 스코프이지 ELANOUS_STATE_DIR 이 아니다
//   (AGENTS.md §Isolated Test Instance 불변식 6). run-mission 과 반드시 동일 config-dir.
import { applyConfigDirFlagFromArgv } from '../src/cli/config-dir-flag.js';
applyConfigDirFlagFromArgv();

import { TaskStore } from '../src/task-orchestrator/store.js';
import { createMission, openAutopilotMissionsDb, getMission } from '../src/autopilot/mission-registry.js';
import { createTask } from '../src/task-orchestrator/types.js';

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };

// ── --cleanup ────────────────────────────────────────────────────────────────
const cleanupId = arg('--cleanup');
if (cleanupId) {
  const { cancelMission } = await import('../src/autopilot/mission-lifecycle.js');
  const r = await cancelMission(cleanupId, {});
  console.log(`dogfood 미션 정리: ${cleanupId} · ok=${r.ok}${r.error ? ` (${r.error})` : ''}`);
  process.exit(0);
}

// ── walker(조사) 단일 페이즈 미션 생성 — worktree 격리 실증용 ────────────────
const store = new TaskStore();
let missionId = '';
try {
  // slug 영문 명시 — 운영 경로(createMissionWithSlug→generateMissionSlug)는 LLM 영문 kebab title 이라
  // missionId 에 한글이 안 섞인다. dogfood 는 createMission 직접 호출이라 slug 미지정 시 slugify(한글 유지)
  // → 브랜치명 검증("alphanumeric plus . _ - /") 실패. slug 를 영문으로 줘 운영과 정합(브랜치=se/mission-apm_<slug>_).
  const m = createMission(store, {
    goal: 'DOGFOOD walker 격리 실증(2026-07-21) — walker 조사 페이즈가 미션 worktree 안에서 실행되고 산출(마커 파일)이 worktree 에만 남아 main 트리 무오염임을 확인',
    slug: 'dogfood-walker-worktree-isolation',
    source: 'human-intent',
    triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' },
  });
  missionId = m.id;

  // 단일 operational(walker) 페이즈. "조사" → classifyPhaseKind operational → walker. subagent surface → hasSub.
  // description 이 명시적 파일 write 를 요구 → walker 가 worktree cwd 안에 마커 파일 생성(격리 대상).
  const task = createTask({
    title: '미션 파이프라인 실행 경로 구조 조사',
    description:
      'run-mission 의 walker 페이즈 실행 경로를 간단히 조사하고, 조사 요약(3~5줄)을 현재 작업 디렉터리에 ' +
      'WALKER-ISOLATION-PROBE.md 파일로 저장하라. 파일에는 "walker isolation probe" 문구와 조사 요약을 포함한다(walker 조사 페이즈).',
    surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: '미션 파이프라인 실행 경로 조사 후 WALKER-ISOLATION-PROBE.md 저장' },
    goalSlug: m.id, dependsOn: [], status: 'ready',
    generatedBy: { kind: 'user', actorId: 'dogfood-walker-isolation' },
  }, { allowUncheckedUrgent: true, now: Date.now() });
  store.saveTask(task);

  console.log('── walker worktree 격리 dogfood 미션 생성 ──────────────────');
  console.log(`미션 id     : ${missionId}`);
  console.log(`walker 페이즈: ${task.id} · "${task.title}" · status=ready`);
  console.log('');
  console.log('다음(라이브 실행):');
  console.log(`  ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/run-mission.ts ${missionId} --config-dir $PWD/.elanous-test`);
  console.log('');
  console.log('확인:');
  console.log(`  elanous logs --test --category mission.exec.worktree     # created (worktree 경로)`);
  console.log(`  git status --short && git worktree list                # main 무오염 + dispose`);
} finally {
  store.close();
}

try {
  const mdb = openAutopilotMissionsDb();
  const m = getMission(mdb, missionId);
  mdb.close();
  if (m) console.log(`\n[확인] autopilot 미션 등록됨 · status=${m.status}`);
} catch { /* fail-soft */ }
