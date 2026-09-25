#!/usr/bin/env bun
// ── 시스템 셀프힐링 라이브 dogfood — 합성 결함 escalate 시나리오 (2026-07-13) ──────
//
// 목적: escalate 자율구조(R2 시스템 결함 의심 → R3 Opus 룩백 → system-repair 수리미션 스폰)를
// 실제 monad 코드를 망가뜨리지 않고 라이브 검증. 합성 결함 미션 + 실패 페이즈([SUSPECT] 신호)를
// 실제 DB 에 만들어, escalate 가 그 신호를 복원해 R3 Opus 조사 후 수리 미션을 스폰하는지 본다.
//
// 사용:
//   bun scripts/dogfood-selfheal-escalate.ts            # 합성 결함 미션 생성 → id 출력
//   monad autopilot escalate <missionId> 0              # escalate 트리거(별도·라이브 관찰)
//   bun scripts/dogfood-selfheal-escalate.ts --cleanup <missionId>   # dogfood 미션 정리
//
// 안전: escalate 가 스폰하는 수리 미션은 human-intent 라 분해 후 HITL 승인 대기(자동 실행 안 함).
// 실 Opus 수리빌드/merge/데몬 재시작은 대표 승인 전 멈춘다. dogfood 미션은 --cleanup 로 정리.

import { TaskStore } from '../src/task-orchestrator/store.js';
import { createMission, openAutopilotMissionsDb, getMission } from '../src/autopilot/mission-registry.js';
import { createTask } from '../src/task-orchestrator/types.js';
import { detectContradictions, renderSuspectNotes } from '../src/autopilot/contradiction-detector.js';
import { buildPhaseOutcomeFromSummary, synthesizePhaseDiagnosis, buildDiagnosisNote } from '../src/autopilot/mission-phase-diagnosis.js';

const cleanupIdx = process.argv.indexOf('--cleanup');
if (cleanupIdx >= 0) {
  const id = process.argv[cleanupIdx + 1];
  if (!id) { console.error('사용: --cleanup <missionId>'); process.exit(1); }
  const { cancelMission } = await import('../src/autopilot/mission-lifecycle.js');
  const { listSystemRepairAuthorized } = await import('../src/autopilot/system-repair.js');
  const r = await cancelMission(id, {});
  console.log(`dogfood 미션 정리: ${id} · ok=${r.ok}${r.error ? ` (${r.error})` : ''}`);
  // escalate 로 스폰된 수리 미션도 있으면 안내(수동 정리 대상).
  const repairs = listSystemRepairAuthorized().filter((m) => m !== id);
  if (repairs.length) console.log(`⚠️ system-repair 등재 미션(수리 미션·필요 시 정리): ${repairs.join(', ')}`);
  process.exit(0);
}

// ── 1. 합성 결함 미션 + 실패 페이즈 생성 ────────────────────────────────────
const store = new TaskStore();
let missionId = '';
let phaseId = '';
try {
  const m = createMission(store, {
    goal: 'DOGFOOD 합성 시스템 결함 escalate 검증(2026-07-13) — 급락 관측 어댑터 페이즈가 diff 본문 캡처 결함으로 반복 실패',
    source: 'human-intent',
    triage: { executionModel: 'task', tier: 'heavy', engine: 'tox' },
  });
  missionId = m.id;

  // 합성 R2 모순 — files-touched-but-empty-diff(변경 파일은 있는데 diff 본문 0 = 캡처/전파 결함).
  const signals = detectContradictions({ changedFiles: ['src/domains/price-guard-adapter.ts', 'tests/price-guard.test.ts'], diffBody: '' });

  // 실패 페이즈 outcome → 진단(systemSuspect → rec=escalate).
  const outcome = buildPhaseOutcomeFromSummary({
    phaseId: 'pending', missionId: m.id, title: '급락 관측 → S4 어댑터 구현',
    index: 0, total: 3, status: 'failed',
    summary: 'gate-failed — 변경 파일은 있으나 diff 본문이 비어 검증 불가(무결성 게이트 통과인데 비평 FAIL)',
  });
  outcome.diffSummary = { filesTouched: ['src/domains/price-guard-adapter.ts', 'tests/price-guard.test.ts'], plannedFiles: [], added: 0, deleted: 0 };
  const diag = synthesizePhaseDiagnosis(outcome);

  const task = createTask({
    title: '급락 관측 → S4 어댑터 구현',
    description: '합성 결함 dogfood 페이즈(실제 구현 아님)',
    surface: { kind: 'subagent', definitionName: 'general-purpose', prompt: 'dogfood' },
    goalSlug: m.id, dependsOn: [], status: 'failed',
    generatedBy: { kind: 'user', actorId: 'dogfood-selfheal' },
  }, { allowUncheckedUrgent: true, now: Date.now() });
  phaseId = task.id;
  // [DIAGNOSIS] + [SUSPECT] 영속 — escalate 가 [SUSPECT] 로 신호 복원.
  store.saveTask({ ...task, notes: [buildDiagnosisNote(diag, outcome.failClass), ...renderSuspectNotes(signals)] });

  console.log('── 합성 결함 dogfood 미션 생성 ──────────────────────────────');
  console.log(`미션 id     : ${missionId}`);
  console.log(`실패 페이즈  : ${phaseId} · "급락 관측 → S4 어댑터 구현"`);
  console.log(`진단 권장 힐 : ${diag.healRecommendation.kind} (${diag.healRecommendation.confidence})  ← escalate 여야 정상`);
  console.log(`R2 모순     : ${signals.map((s) => s.kind).join(', ')}`);
  console.log('');
  console.log('다음(라이브 관찰):');
  console.log(`  monad autopilot escalate ${missionId} 0`);
  console.log('  → [SUSPECT] 복원 → R3 fresh Opus 룩백 → system-repair 수리 미션 스폰(분해→HITL 대기)');
  console.log('');
  console.log('정리:');
  console.log(`  bun scripts/dogfood-selfheal-escalate.ts --cleanup ${missionId}`);
} finally {
  store.close();
}

// 미션 등록 확인(autopilot missions DB 에도 보이는지).
try {
  const mdb = openAutopilotMissionsDb();
  const m = getMission(mdb, missionId);
  mdb.close();
  if (m) console.log(`\n[확인] autopilot 미션 등록됨 · status=${m.status}`);
} catch { /* fail-soft */ }
