#!/usr/bin/env bun
// ── Self-Evolution · 백엔드 구현능력 3-way 벤치 (2026-07-11) ─────────────────
// 같은 태스크([1] TOX persistence)를 3 백엔드로 각각 격리 worktree 에서 자율 구현 →
// 파일 수·LOC·게이트 통과·소요시간 측정·비교. 대표 질문(자체구현 능력·ACP 위임 단위·모델선택).
//   ① monad-self      : bun se-monad-self-impl.ts (getAutopilotToolRegistry·gpt-5.6-sol)
//   ② codex-app-server: dispatchDelegateAgent (codex ACP 위임)
//   ③ claude          : dispatchDelegateAgent (claude code ACP 위임)
// 사용: bun scripts/se-backend-bench.ts [--only monad-self|codex|claude]

import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createIsolatedInstance, disposeIsolatedInstance, type IsolatedPlan } from '../src/autopilot/build/isolated-instance.js';
import { runIntegrityGate, type GateResult } from '../src/autopilot/build/integrity-gate.js';
import { dispatchDelegateAgent } from '../src/boot/daemon-tools/delegate-agent.js';

const repoRoot = join(import.meta.dir, '..');
const onlyArg = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : undefined; })();

const TASK = [
  'Implement "TOX persistence: schema version guard + migration" in this repository.',
  '',
  'Concretely:',
  '- In src/task-orchestrator/, add a schema version constant and a migration path so the task graph',
  '  persistence is no longer hard-coded to v1 (reuse existing graph load/save helpers — do not add a',
  '  parallel serializer).',
  '- Add a runtime guard: a task with priority === "urgent" and zero deterministic acceptance.checks',
  '  must be rejected with a clear error before persistence.',
  '- Add a focused unit test for the guard + the version/migration.',
  '',
  'Rules: reuse existing code, keep the change small (<250 LOC). Do NOT touch trade/arming/safety/reboot.',
  'bun test src/task-orchestrator/ must pass. Do not commit — leave the changes in the working tree.',
].join('\n');

interface Bench { backend: string; ok: boolean; durationSec: number; files: number; insertions: number; deletions: number; gatePass: boolean; note: string }

export function summarizeGate(gate: GateResult): Pick<Bench, 'gatePass' | 'note'> {
  return {
    gatePass: gate.passed,
    note: gate.passed ? '게이트 PASS' : `게이트 FAIL: ${gate.steps.map(s => s.summary).join('; ').slice(0, 80)}`,
  };
}

/** worktree 변경 측정(신규+수정 파일·삽입/삭제). */
function measure(wt: string): { files: number; insertions: number; deletions: number } {
  try {
    execFileSync('git', ['-C', wt, 'add', '-A', '--', ':(exclude)node_modules', ':(exclude)apps/pwa/out'], { stdio: 'ignore' });
    const stat = execFileSync('git', ['-C', wt, 'diff', '--cached', '--shortstat'], { encoding: 'utf-8' }).trim();
    const files = Number(stat.match(/(\d+) files? changed/)?.[1] ?? 0);
    const insertions = Number(stat.match(/(\d+) insertions?/)?.[1] ?? 0);
    const deletions = Number(stat.match(/(\d+) deletions?/)?.[1] ?? 0);
    return { files, insertions, deletions };
  } catch { return { files: 0, insertions: 0, deletions: 0 }; }
}

async function runMonadSelf(plan: IsolatedPlan): Promise<void> {
  // 격리 서브프로세스(cwd=worktree)로 monad-self 러너 스폰. 도구가 worktree 편집.
  // 튜닝 확정 config(2026-07-11·[[REPORT-monad-self-tuning-2026-07-11]]): effort=medium·
  // maxTurns=40·optimized 프롬프트(+cwd)·검증-주도 adaptive 폐루프(verify=게이트 스코프 일치).
  // 이 config 로 monad-self 가 원 리포트의 "예산 소진 실패"를 넘어 실 구현을 완결한다.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MONAD_SELF_MODEL: 'gpt-5.6-terra', // 튜닝 매트릭스 최적 codex(안정·최속). config 기본 sol 은 코딩 비효율.
    MONAD_SELF_EFFORT: 'medium',
    MONAD_SELF_MAX_TURNS: '40',
    MONAD_SELF_SYSTEM: 'optimized',
    MONAD_SELF_ADAPTIVE: '1',
    MONAD_SELF_VERIFY_CMD: 'bun test src/task-orchestrator/',
  };
  spawnSync('bun', [join(repoRoot, 'scripts/se-monad-self-impl.ts'), TASK],
    { cwd: plan.worktreePath, stdio: 'inherit', timeout: 1_800_000, env });
}

async function runDelegate(plan: IsolatedPlan, backend: string): Promise<void> {
  const ctx = { cwd: plan.worktreePath, signal: new AbortController().signal } as never;
  await dispatchDelegateAgent({ backend, task: TASK, cwd: plan.worktreePath }, ctx);
}

const BACKENDS: Array<{ name: string; key: string; run: (p: IsolatedPlan) => Promise<void> }> = [
  { name: 'monad-self', key: 'monad-self', run: (p: IsolatedPlan) => runMonadSelf(p) },
  { name: 'codex-ACP', key: 'codex', run: (p: IsolatedPlan) => runDelegate(p, 'codex-app-server') },
  { name: 'claude-ACP', key: 'claude', run: (p: IsolatedPlan) => runDelegate(p, 'claude') },
].filter(b => !onlyArg || b.key === onlyArg || b.name === onlyArg);

async function main(): Promise<void> {
const results: Bench[] = [];
for (const b of BACKENDS) {
  const slug = `bench-${b.key}-${Date.now().toString(36)}`;
  console.log(`\n━━━ ${b.name} (worktree se/${slug}) ━━━`);
  let plan: IsolatedPlan | null = null;
  const t0 = Date.now();
  try {
    plan = createIsolatedInstance(repoRoot, slug, 'main');
    await b.run(plan);
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const m = measure(plan.worktreePath);
    const gate = await runIntegrityGate(plan.worktreePath, { steps: ['test'], testArgs: ['src/task-orchestrator/'] });
    results.push({ backend: b.name, ok: m.files > 0, durationSec, ...m, ...summarizeGate(gate) });
    console.log(`  ${b.name}: 파일 ${m.files} · +${m.insertions}/-${m.deletions} · ${durationSec}s · 게이트 ${gate.passed ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    results.push({ backend: b.name, ok: false, durationSec: Math.round((Date.now() - t0) / 1000), files: 0, insertions: 0, deletions: 0, gatePass: false, note: `오류: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120) });
    console.log(`  ${b.name}: 오류 — ${e instanceof Error ? e.message : e}`);
  } finally {
    if (plan) { try { disposeIsolatedInstance(repoRoot, plan); } catch { /* */ } try { execFileSync('git', ['-C', repoRoot, 'branch', '-D', plan.branch], { stdio: 'ignore' }); } catch { /* */ } }
  }
}

console.log('\n\n═══════ 3-way 백엔드 구현능력 비교 ═══════\n');
console.log('| 백엔드 | 파일 | 삽입 | 삭제 | 소요 | 게이트 | 비고 |');
console.log('|---|--:|--:|--:|--:|:--:|---|');
for (const r of results) {
  console.log(`| ${r.backend} | ${r.files} | ${r.insertions} | ${r.deletions} | ${r.durationSec}s | ${r.gatePass ? '✅' : '❌'} | ${r.note} |`);
}
}

if (import.meta.main) await main();
