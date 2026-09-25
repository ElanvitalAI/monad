#!/usr/bin/env bun
// ── Mission Fabric · heavy 미션 멀티페이즈 분해 러너 (2026-07-11) ────────────
// intent-gate 가 heavy(큰) 미션에 대해 detached 로 spawn 한다(데몬 무차단). 정식
// TaskGenerator.decompose(sol/high effort·리즈닝) 로 N 페이즈(backlog·dependsOn)를 만들고
// 플랜 초안(HITL 검토·proposalDraftPath)을 기록한다. 실행은 안 함 — 대표 승인(approveMission)
// 후 페이즈가 dependsOn 순서로 집행된다. 수동 도그푸드: bun scripts/se-mission-expand.ts <missionId>
//
// ★ 미션 분해 = 코딩이 아니라 리즈닝(대표 지시 2026-07-11) → sol + high effort. sweet-spot
//   실험: MONAD_DECOMPOSE_MODEL·MONAD_DECOMPOSE_EFFORT env.

import { decomposeMissionToPhases } from '../src/autopilot/mission-engine.js';

const missionId = process.argv[2];
if (!missionId) { console.error('usage: bun scripts/se-mission-expand.ts <missionId>'); process.exit(1); }

console.error(`[mission-expand] ${missionId} 멀티페이즈 분해 시작(model=${process.env.MONAD_DECOMPOSE_MODEL || 'gpt-5.6-sol'} effort=${process.env.MONAD_DECOMPOSE_EFFORT || 'high'})...`);
const r = await decomposeMissionToPhases(missionId, { maxTasks: Number(process.env.MONAD_DECOMPOSE_MAX || 8) });
if (r.ok) {
  console.error(`[mission-expand] 완료 — ${r.phaseCount} 페이즈(backlog·HITL) · 플랜 ${r.planPath ?? '(초안 없음)'}${r.note ? ` · ${r.note}` : ''}`);
} else {
  console.error(`[mission-expand] 실패 — ${r.error}`);
  process.exit(1);
}
