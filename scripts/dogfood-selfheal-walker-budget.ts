#!/usr/bin/env bun
// ── 순수 라이브 self-heal 재현 dogfood — walker 예산소진 → aa1Heal autonomous retry (2026-07-19) ──
//
// 목적: "실 미션 실패로 라이브 self-heal 발동"을 재현. tiny walker 예산(→ maxTurns=1 강제)으로
// 실제 walker(조사) 페이즈를 예산소진 실패시키면, run-mission 이 budget/run_failed 로 분류(2026-07-19
// 예산강제↔self-heal 연결 수정) → GoalBlocker run_failed → decideAutonomousAct autonomous → [AA1-HEAL:retry].
//
// 사용(전부 테스트 스코프 — 운영 무접촉):
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-selfheal-walker-budget.ts        # 미션 생성 → id 출력
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/run-mission.ts <id> --config-dir $PWD/.elanous-test
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-selfheal-walker-budget.ts --inspect <id>   # 힐 흔적 확인
//   ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-selfheal-walker-budget.ts --cleanup <id>
//
// 선행: .elanous-test/config.json 에 autopilot.selfHealAutoExec=true · autopilot.budget.walker=[8000].
// 안전: 테스트 인스턴스라 DISARMED(무장 파일 부재) · walker=읽기전용 조사 · self-heal=비파괴 워킹메모리 주입.

// ★ config-dir 격리 필수 — tasks.db 는 getElanousConfigDir(config-dir) 스코프이지 ELANOUS_STATE_DIR 이
//   아니다(paths.ts:33). --config-dir 미적용 시 운영 ~/.elanous/tasks/tasks.db 에 미션이 새어든다.
//   TaskStore 열기 전에 strip+적용(run-mission/se-mission-prepare 동형). run-mission 과 반드시 동일 config-dir.
import { applyConfigDirFlagFromArgv } from '../src/cli/config-dir-flag.js';
applyConfigDirFlagFromArgv();

import { TaskStore } from '../src/task-orchestrator/store.js';
import { createMission, openAutopilotMissionsDb, getMission } from '../src/autopilot/mission-registry.js';
import { createTask } from '../src/task-orchestrator/types.js';

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };

// ── --inspect: 힐 흔적(자기인지) 확인 ────────────────────────────────────────
const inspectId = arg('--inspect');
if (inspectId) {
  const store = new TaskStore();
  try {
    const tasks = store.listTasks({ goalSlug: inspectId });
    console.log(`── self-heal 흔적 검사 · 미션 ${inspectId} · 페이즈 ${tasks.length}개 ──`);
    for (const t of tasks) {
      const notes = t.notes ?? [];
      const heal = notes.filter((n) => /AA1-HEAL|AA1-HITL|셀프힐/.test(n));
      console.log(`\n페이즈 ${t.id} · "${t.title}" · status=${t.status}`);
      if (heal.length) heal.forEach((n) => console.log(`  ✅ ${n.slice(0, 200)}`));
      else console.log(`  (힐 흔적 없음 — notes ${notes.length}건)`);
    }
  } finally { store.close(); }
  process.exit(0);
}

// ── --reproduce-heal: self-heal seam 라이브 witness(결정론) ──────────────────
// walker fake-pass(Gap C) 로 tiny 예산 실패가 불안정하므로, budget 실패 summary 를 주입해 실 executor +
// 실 aa1Heal seam(run-mission 배선 동형)이 [AA1-HEAL:retry] 를 실 프로세스/실 stores/실 logs.db 로
// 발동함을 결정론 witness. Gap A(예산-cap 실패→budget 분류) 가 만드는 summary 형식을 그대로 사용.
if (process.argv.includes('--reproduce-heal')) {
  const { runMultiphaseMission } = await import('../src/autopilot/mission-multiphase-executor.js');
  const { classifyGoalBlocker, goalBlockerToHealRecommend } = await import('../src/autopilot/pipeline/goal-blocker.js');
  const { observeCoordinator } = await import('../src/autopilot/pipeline/mission-progress-ledger.js');
  const { coordinatorRecordMemory } = await import('../src/autopilot/pipeline/coordinator-memory.js');
  // 관측 3박자 — standalone 프로세스라 StoreSink 미상속. 등록해야 observeCoordinator 가 logs.db 에 닿는다
  // (run-mission.ts:246 동형). 미등록 시 힐 흔적은 파일 트레일만 → `elanous logs --category mission.coordinator` 무실효.
  try {
    const [storeMod, dbgMod, cfgMod] = await Promise.all([
      import('../src/mss/logging/log-store.js'), import('../src/debug/log.js'), import('../src/user-config.js'),
    ]);
    const logsCfg = cfgMod.getUserConfig().logs;
    storeMod.setLogInstanceName(logsCfg.instanceName);
    const off = storeMod.registerLogStoreSink((s) => dbgMod.debug.registerSink(s), 'autopilot', logsCfg.retention);
    if (off) process.on('exit', off);
  } catch { /* fail-soft */ }
  const store = new TaskStore();
  const m = createMission(store, {
    goal: 'DOGFOOD self-heal seam witness(2026-07-19) — 주입 budget 실패로 aa1Heal autonomous retry 결정론 발동',
    source: 'human-intent', triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' },
  });
  const task = createTask({
    title: '코드베이스 조사(주입 실패)', description: 'self-heal witness', surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 'x' },
    goalSlug: m.id, dependsOn: [], status: 'ready', generatedBy: { kind: 'user', actorId: 'dogfood-heal-witness' },
  }, { allowUncheckedUrgent: true, now: Date.now() });
  store.saveTask(task);
  // run-mission(scripts/run-mission.ts:711) aa1Heal seam 과 동형.
  const seam = {
    recommend: (t: { id: string; title: string }, summary: string) => {
      const v = classifyGoalBlocker(summary);
      try { observeCoordinator('heal-blocker', m.id, { phaseId: t.id, kind: v.kind, route: v.route, autoHealable: v.autoHealable }); } catch { /* fail-soft */ }
      return goalBlockerToHealRecommend(v);
    },
    execute: async (t: { id: string; title: string }, kind: string) => {
      try {
        coordinatorRecordMemory(m.id, { phaseId: t.id, phaseTitle: t.title, kind: 'operational',
          summary: `[셀프힐:${kind}] 주입 budget 실패 — 다음 시도는 이 진단 반영(자동 재계획)`, reusables: [], decisions: [], artifacts: [], deviation: { kind: 'self_heal', note: kind } });
        observeCoordinator('heal-execute', m.id, { phaseId: t.id, kind });
        return true;
      } catch { return false; }
    },
  };
  // Gap A 가 만드는 실패 summary 형식(budget → RUN_FAILED → autonomous retry).
  const injectedSummary = '[판정누락(fail)·budget·1회 시도] walker 조사 예산소진(maxTurns=1 강제) — 조사 미완';
  const r = await runMultiphaseMission(m.id, async () => ({ ok: false, summary: injectedSummary }), { store, aa1Heal: seam });
  const notes = store.listTasks({ goalSlug: m.id }).find((t) => t.id === task.id)?.notes ?? [];
  const healMark = notes.find((n) => /AA1-HEAL|AA1-HITL/.test(n));
  console.log('── self-heal seam 라이브 witness ─────────────────────────────');
  console.log(`미션            : ${m.id}`);
  console.log(`주입 실패 summary: ${injectedSummary}`);
  console.log(`실 executor 결과 : done=${r.done} failed=${r.failed}`);
  console.log(`분류            : ${JSON.stringify(goalBlockerToHealRecommend(classifyGoalBlocker(injectedSummary)))}`);
  console.log(`페이즈 힐 흔적   : ${healMark ?? '(없음)'}`);
  console.log(`관측(logs.db)   : elanous logs --test --category mission.coordinator (heal-blocker·heal-execute)`);
  store.close();
  process.exit(healMark && /AA1-HEAL:retry/.test(healMark) ? 0 : 1);
}

// ── --cleanup ────────────────────────────────────────────────────────────────
const cleanupId = arg('--cleanup');
if (cleanupId) {
  const { cancelMission } = await import('../src/autopilot/mission-lifecycle.js');
  const r = await cancelMission(cleanupId, {});
  console.log(`dogfood 미션 정리: ${cleanupId} · ok=${r.ok}${r.error ? ` (${r.error})` : ''}`);
  process.exit(0);
}

// ── 1. walker(조사) 단일 페이즈 미션 생성 ───────────────────────────────────
const store = new TaskStore();
let missionId = '';
try {
  const m = createMission(store, {
    goal: 'DOGFOOD 순수 라이브 self-heal 재현(2026-07-19) — 코드베이스 조사 페이즈를 tiny 예산으로 예산소진 실패시켜 aa1Heal autonomous retry 발동',
    source: 'human-intent',
    triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' },
  });
  missionId = m.id;

  // 단일 operational(walker) 페이즈 — 제목에 "조사/분석" → classifyPhaseKind operational → walker 라우팅.
  // status 'ready' 라 run-mission 이 즉시 실행. acceptance 로 필수 산출물 요구(예산소진으로 미달→실패).
  const task = createTask({
    title: '코드베이스 미션 파이프라인 구조 심층 조사·분석',
    description: 'run-mission/executor/self-heal 배선을 조사하고 요약 산출물을 저장하라(walker 조사 페이즈).',
    surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: '코드베이스 구조 조사' },
    goalSlug: m.id, dependsOn: [], status: 'ready',
    generatedBy: { kind: 'user', actorId: 'dogfood-selfheal-walker' },
  }, { allowUncheckedUrgent: true, now: Date.now() });
  store.saveTask(task);

  console.log('── walker 예산소진 self-heal dogfood 미션 생성 ──────────────');
  console.log(`미션 id    : ${missionId}`);
  console.log(`walker 페이즈: ${task.id} · "${task.title}" · status=ready`);
  console.log('');
  console.log('다음(라이브 실행):');
  console.log(`  ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/run-mission.ts ${missionId} --config-dir $PWD/.elanous-test`);
  console.log(`  → tiny 예산(8000)→maxTurns=1→조사 미완→[budget]→run_failed→autonomous→[AA1-HEAL:retry]`);
  console.log('');
  console.log('확인:');
  console.log(`  ELANOUS_STATE_DIR=$PWD/.elanous-test bun scripts/dogfood-selfheal-walker-budget.ts --inspect ${missionId}`);
} finally {
  store.close();
}

try {
  const mdb = openAutopilotMissionsDb();
  const m = getMission(mdb, missionId);
  mdb.close();
  if (m) console.log(`\n[확인] autopilot 미션 등록됨 · status=${m.status}`);
} catch { /* fail-soft */ }
