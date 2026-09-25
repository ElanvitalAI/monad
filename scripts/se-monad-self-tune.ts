#!/usr/bin/env bun
// ── Self-Evolution · monad-self 튜닝 하니스 (2026-07-11) ────────────────────
// monad-self(se-monad-self-impl.ts) 단독을 격리 worktree 에서 반복 실행하며
// model × effort × maxTurns × adaptive 조합을 실측(파일/LOC/게이트/시간). sweet spot 탐색용.
// se-backend-bench.ts 의 monad-self 전용·다축·빠른 iteration 판.
//
// 사용:
//   bun scripts/se-monad-self-tune.ts --turns 24 --effort high --model gpt-5.6-sol [--adaptive] [--keep] [--task hello|tox]
//   bun scripts/se-monad-self-tune.ts --matrix     # 사전정의 매트릭스 순차 실행
// 결과는 stdout 표 + docs/se-tune-results.jsonl append.

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIsolatedInstance, disposeIsolatedInstance, type IsolatedPlan } from '../src/autopilot/build/isolated-instance.js';
import { runIntegrityGate, type GateResult } from '../src/autopilot/build/integrity-gate.js';

const repoRoot = join(import.meta.dir, '..');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

const TASK_TOX = [
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

const TASK_HELLO = [
  'Create a file scripts/monad-self-smoke.ts that exports a function add(a:number,b:number):number returning a+b,',
  'and a matching test scripts/monad-self-smoke.test.ts using bun:test that asserts add(2,3)===5.',
  'Run the test to confirm it passes. Do not commit — leave changes in the working tree.',
].join('\n');

interface Row {
  label: string; model: string; effort: string; maxTurns: string; adaptive: boolean; system: string; task: string;
  files: number; insertions: number; deletions: number; durationSec: number; gatePass: boolean; realImpl: boolean; note: string;
}

function measure(wt: string): { files: number; insertions: number; deletions: number } {
  try {
    execFileSync('git', ['-C', wt, 'add', '-A', '--', ':(exclude)node_modules', ':(exclude)apps/pwa/out'], { stdio: 'ignore' });
    const stat = execFileSync('git', ['-C', wt, 'diff', '--cached', '--shortstat'], { encoding: 'utf-8' }).trim();
    return {
      files: Number(stat.match(/(\d+) files? changed/)?.[1] ?? 0),
      insertions: Number(stat.match(/(\d+) insertions?/)?.[1] ?? 0),
      deletions: Number(stat.match(/(\d+) deletions?/)?.[1] ?? 0),
    };
  } catch { return { files: 0, insertions: 0, deletions: 0 }; }
}

interface Combo { label: string; model?: string; effort?: string; turns?: string; adaptive?: boolean; task?: string; system?: string; gateArgs?: string[] }

export function summarizeTuneGate(gate: GateResult, files: number): Pick<Row, 'gatePass' | 'realImpl' | 'note'> {
  const realImpl = files > 0 && gate.passed;
  return {
    gatePass: gate.passed,
    realImpl,
    note: gate.passed ? (files > 0 ? 'PASS+impl' : 'PASS(변경0=FP)') : `FAIL: ${gate.steps.map(s => s.summary).join(';').slice(0, 60)}`,
  };
}

async function runOne(c: Combo): Promise<Row> {
  const task = c.task === 'hello' ? TASK_HELLO : TASK_TOX;
  const gateArgs = c.gateArgs ?? (c.task === 'hello' ? ['scripts/monad-self-smoke.test.ts'] : ['src/task-orchestrator/']);
  const slug = `tune-${c.label.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}`;
  console.log(`\n━━━ ${c.label} · model=${c.model ?? 'default'} effort=${c.effort ?? 'config'} turns=${c.turns ?? 'familyDef'} adaptive=${c.adaptive ? 'Y' : 'N'} ━━━`);
  let plan: IsolatedPlan | null = null;
  const t0 = Date.now();
  try {
    plan = createIsolatedInstance(repoRoot, slug, 'main');
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (c.model) env.MONAD_SELF_MODEL = c.model;
    if (c.effort) env.MONAD_SELF_EFFORT = c.effort;
    if (c.turns) env.MONAD_SELF_MAX_TURNS = c.turns;
    if (c.adaptive) { env.MONAD_SELF_ADAPTIVE = '1'; env.MONAD_SELF_VERIFY_CMD = `bun test ${gateArgs.join(' ')}`; }
    if (c.system) env.MONAD_SELF_SYSTEM = c.system;
    spawnSync('bun', [join(repoRoot, 'scripts/se-monad-self-impl.ts'), task],
      { cwd: plan.worktreePath, stdio: 'inherit', timeout: 1_800_000, env });
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const m = measure(plan.worktreePath);
    const gate = await runIntegrityGate(plan.worktreePath, { steps: ['test'], testArgs: gateArgs });
    // realImpl = 변경 파일 존재 AND 게이트 통과(변경0 false-positive 배제).
    const gateSummary = summarizeTuneGate(gate, m.files);
    const row: Row = {
      label: c.label, model: c.model ?? 'default', effort: c.effort ?? 'config', maxTurns: c.turns ?? 'familyDef',
      adaptive: !!c.adaptive, system: c.system ?? 'thin', task: c.task ?? 'tox', ...m, durationSec, ...gateSummary,
    };
    console.log(`  → 파일 ${m.files} · +${m.insertions}/-${m.deletions} · ${durationSec}s · 게이트 ${gate.passed ? 'PASS' : 'FAIL'} · 실구현 ${gateSummary.realImpl ? '✅' : '❌'}`);
    if (flag('keep') && plan) {
      console.log(`  [keep] worktree 보존: ${plan.worktreePath} (diff: git -C ${plan.worktreePath} diff --cached)`);
    }
    return row;
  } finally {
    if (plan && !flag('keep')) {
      try { disposeIsolatedInstance(repoRoot, plan); } catch { /* */ }
      try { execFileSync('git', ['-C', repoRoot, 'branch', '-D', plan.branch], { stdio: 'ignore' }); } catch { /* */ }
    }
  }
}

// 사전정의 매트릭스 — optimized 프롬프트·툴 자동복구·cwd 힌트·검증-주도 adaptive 는 기본.
// 남은 축: model{sol,terra,opus} × effort{low,medium,high}. sweet spot 확정용.
const OPT = { system: 'optimized', turns: '40', adaptive: true } as const;
const MATRIX: Combo[] = [
  // effort 스윕(sol) — re-read pathology vs 완결력 트레이드오프.
  { label: 'sol-low',    model: 'gpt-5.6-sol',   effort: 'low',    ...OPT },
  { label: 'sol-med',    model: 'gpt-5.6-sol',   effort: 'medium', ...OPT },
  { label: 'sol-high',   model: 'gpt-5.6-sol',   effort: 'high',   ...OPT },
  // terra(코딩 강세·저비용) effort 스윕.
  { label: 'terra-low',  model: 'gpt-5.6-terra', effort: 'low',    ...OPT },
  { label: 'terra-med',  model: 'gpt-5.6-terra', effort: 'medium', ...OPT },
  { label: 'terra-high', model: 'gpt-5.6-terra', effort: 'high',   ...OPT },
  // opus 기준선(anthropic·self-regulating).
  { label: 'opus',       model: 'claude-opus-4-8', ...OPT },
];

async function main(): Promise<void> {
const rows: Row[] = [];
const combos: Combo[] = flag('matrix')
  ? MATRIX
  : [{ label: arg('label', 'adhoc')!, model: arg('model'), effort: arg('effort'), turns: arg('turns'), adaptive: flag('adaptive'), task: arg('task'), system: arg('system') }];

for (const c of combos) {
  const row = await runOne(c);
  rows.push(row);
  try { appendFileSync(join(repoRoot, 'docs/se-tune-results.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n'); } catch { /* */ }
}

console.log('\n\n═══════ monad-self 튜닝 결과 ═══════\n');
console.log('| label | model | effort | turns | adapt | system | 파일 | +ins | -del | 소요 | 게이트 | 실구현 |');
console.log('|---|---|---|---|:--:|---|--:|--:|--:|--:|:--:|:--:|');
for (const r of rows) {
  console.log(`| ${r.label} | ${r.model} | ${r.effort} | ${r.maxTurns} | ${r.adaptive ? 'Y' : 'N'} | ${r.system} | ${r.files} | ${r.insertions} | ${r.deletions} | ${r.durationSec}s | ${r.gatePass ? '✅' : '❌'} | ${r.realImpl ? '✅' : '❌'} |`);
}
}

if (import.meta.main) await main();
