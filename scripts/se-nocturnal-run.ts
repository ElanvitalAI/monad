#!/usr/bin/env bun
// ── Self-Evolution SE4 · 야간 격리 구현 러너 드라이버 (2026-07-10) ──────────
//
// 승인된 발굴 미션 → 격리 worktree(SE3) → 자율 구현(implement seam·arming-gated) →
// 무결성 게이트(SE4·bun test) → PR 초안. merge 안 함(HITL). build arming off 면 skeleton.
//
// 실 seam: gate=runIntegrityGate(격리 cwd 실행)·makePr=git push+gh. implement seam 은
// 데몬 dual-role delegate ctx 를 요구(globalDualRoleManager) → 데몬 내부에서 주입.
// 스탠드얼론(이 스크립트)은 disarmed skeleton + 게이트/PR 배선 검증용. 실 자율구현=SE6.
//
// 사용: bun scripts/se-nocturnal-run.ts [--mission <id>] [--gate-only]

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openAutopilotMissionsDb, listMissions, type MissionRow } from '../src/autopilot/mission-registry.js';
import { missionLifecycleGate } from '../src/autopilot/mission-lifecycle-gate.js';
import { missionToBuildTarget } from '../src/autopilot/build/build-target.js';
import { createIsolatedInstance } from '../src/autopilot/build/isolated-instance.js';
import { runIntegrityGate, renderGateEvidence } from '../src/autopilot/build/integrity-gate.js';
import { runNocturnalOne } from '../src/autopilot/build/nocturnal-runner.js';
import { makeNocturnalDeps } from '../src/autopilot/build/nocturnal-deps.js';
import { buildArmed, loadAutopilotArming } from '../src/autopilot/arming.js';

const repoRoot = join(import.meta.dir, '..');
const missionIdArg = (() => { const i = process.argv.indexOf('--mission'); return i >= 0 ? process.argv[i + 1] : undefined; })();
const gateOnly = process.argv.includes('--gate-only');
// 게이트 테스트 스코프 — 전체 bun test 는 통합/네트워크로 격리서 불안정(SE4 발견).
// 기본 curated(src/autopilot/·고속·신뢰). --gate-scope <path> 로 조정, 'full' 이면 전체.
const gateScopeArg = (() => { const i = process.argv.indexOf('--gate-scope'); return i >= 0 ? process.argv[i + 1] : 'src/autopilot/'; })();

const armed = buildArmed();
const arming = loadAutopilotArming();
console.log(`\n=== SE4 야간 격리 구현 러너 (build.armed=${armed}${armed ? `·backend=${arming.build.backend}` : '·skeleton'}) ===\n`);

// 대상 미션 선택 — 명시 id 또는 발굴(discovery) 미션 중 armed(승인)·heavy.
const db = openAutopilotMissionsDb();
let targets: MissionRow[];
if (missionIdArg) {
  targets = listMissions(db, {}).filter(m => m.id === missionIdArg);
  if (!targets.length) { console.error(`미션 없음: ${missionIdArg}`); process.exit(1); }
} else {
  targets = listMissions(db, { source: 'discovery' }).filter(m => m.status === 'armed' && m.tier === 'heavy');
  console.log(`빌드 대상(승인·heavy·discovery): ${targets.length}건${targets.length ? '' : ' — 없음(대표 승인 대기). 명시하려면 --mission <id>.'}`);
}

// ── 실 seam ─────────────────────────────────────────────────────────────
// createInstance/implement(SE6·코딩 백엔드 3종)/changedFiles/gate(bun test)/makePr(git+gh)
// 배선은 makeNocturnalDeps(단일 출처·se-bridge 와 공유)로 이관. 격리 disarmed config(SE3)+
// IMMUTABLE_CORE 게이트(SE5)+worktree 격리가 안전 보장. 격리 worktree 는 항상 main 기준
// (자율 PR 을 깨끗한 main 베이스로). markBuilt 만 이 스크립트 고유(미션 status='done').
const deps = makeNocturnalDeps({
  repoRoot,
  backend: arming.build.backend,
  gateScope: gateScopeArg,
  base: 'main',
  markBuilt: (missionId, note) => { try { missionLifecycleGate(db, missionId, 'done', 'nocturnal-built', new Date()); } catch { /* */ } console.log(`  markBuilt ${missionId}: ${note}`); },
});

// ── --gate-only: 승인 미션 없이 격리 게이트만 실증(격리서 bun test green 증명) ──
// curated 스코프(src/autopilot/)로 고속 실증 — 전체 bun test 는 통합/네트워크 테스트로
// 격리서 불안정 가능(SE6 는 curated 게이트 스코프 필요·dogfood 발견).
if (gateOnly) {
  // ⛔⭐ `runIntegrityGate` 는 async 다 — 종전 판은 `await` 없이 받아 `Promise` 를 결과로 읽었고
  //   `r.passed` 가 항상 `undefined` 라 «격리 게이트 결과: FAIL» 을 늘 찍었다(tsc 2건이 이미 빨갰다).
  //   ⚠️ 이 블록은 top-level 이라 `await` 를 못 쓰므로 async IIFE 로 감싼다.
  await (async () => {
    const slug = `gate-${Date.now().toString(36)}`;
    const testArgs = ['src/autopilot/'];
    console.log(`[gate-only] 격리 인스턴스 생성 → runIntegrityGate(bun test ${testArgs.join(' ')}) 실증 (slug=${slug})`);
    const plan = createIsolatedInstance(repoRoot, slug, 'HEAD');
    try {
      const r = await runIntegrityGate(plan.worktreePath, { steps: ['test'], testArgs });
      console.log('\n' + renderGateEvidence(r) + '\n');
      console.log(`격리 게이트 결과: ${r.passed ? 'PASS' : 'FAIL'}`);
    } finally {
      deps.dispose?.(plan);
      console.log('[gate-only] 격리 인스턴스 정리됨.');
    }
  })();
  db.close();
  process.exit(0);
}

// ── 본 러너 ──
(async () => {
  for (const m of targets) {
    const target = missionToBuildTarget(m);
    if (target.planPath && !existsSync(target.planPath)) {
      console.log(`  ⚠️ 플랜 초안 없음(${target.planPath}) — SE2 intake 재실행 필요.`);
    }
    console.log(`\n▶ ${target.title} (${target.id})`);
    const r = await runNocturnalOne(target, armed, deps);
    console.log(`  status=${r.status} · ${r.next}${r.prUrl ? ` · PR ${r.prUrl}` : ''}`);
  }
  if (!targets.length && !gateOnly) console.log('\n(빌드 대상 없음 · --gate-only 로 격리 게이트 실증 가능)');
  db.close();
})();
