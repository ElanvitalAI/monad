import { describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchMonadAutopilotLaunch } from '../src/tool-runtime/monad-autopilot-launch-runtime.js';
import { formatGoalFileLintFinding } from '../src/self-implement/goal-author.js';

const formatDiagnosticOutput = (diagnostics: Parameters<typeof formatGoalFileLintFinding>[0][]): string =>
  diagnostics.map(formatGoalFileLintFinding).join('\n');

const canonicalGoal = (scopeBoundary = 'narrow'): string => `## PROBLEM
problem

## WHAT TO BUILD
build

## ACCEPTANCE CRITERIA
criteria

## REQUIRED EVIDENCE
- [proof] focused test

## TRACED PATHS
paths

## SCOPE BOUNDARY
${scopeBoundary}

## 답하지 못하는 것
unknowns

## 불변식
invariants

## 판정 신호
signals
`;

describe('monad_autopilot_launch goal-file preflight', () => {
  // ⚠️ 2026-08-01 계약 변경([T] 교차 리뷰): goalFile 없이도 **발사한다**(종전 동작 보존).
  //   ⛔ 필수 차단은 기존 MCP 호출자를 전부 깨뜨렸다 — 그건 이 골이 요구한 것이 아니다.
  //   ⭐ 린트는 goalFile 을 **줬을 때만** 돌고, 그때 ERROR 면 막는다(아래 테스트가 고정).
  test('goal file 없이 부르면 종전대로 에이전트를 띄운다 (탈출구)', async () => {
    let spawned = false;
    const result = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely' },
      { spawnAgent: async () => { spawned = true; throw new Error('spawn attempted'); } },
    );

    expect(spawned).toBe(true);
    expect(result.termination).not.toEqual({ kind: 'error', message: 'goal-file-required' });
    expect(result.diagnostics).toEqual([]);
  });

  // ⛔⭐ 우회는 관측에 남아야 한다([T] 교차 리뷰) — dev-pipeline 의 goal-file-evidence-bypassed 와 같은 형태.
  //   안 남기면 "몇 번 우회했나" 를 셀 수 없고, 다음 창이 0 을 "안 썼다" 로 오독한다(제1원칙).
  test('goal file 없이 부르면 우회를 관측에 남긴다', async () => {
    const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const spy = spyOn(debug, 'log').mockImplementation(((_c: string, event: string, data?: Record<string, unknown>) => {
      events.push({ event, data });
    }) as never);
    try {
      await dispatchMonadAutopilotLaunch(
        { mission: 'implement safely' },
        { spawnAgent: async () => { throw new Error('spawn attempted'); } },
      );
    } finally {
      spy.mockRestore();
    }
    expect(events.some((e) => e.event === 'goal-lint-skipped' && e.data?.reason === 'no-goal-file')).toBe(true);
  });

  test('blocks an invalid authored goal before spawning an agent', async () => {
    let spawned = false;
    const result = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely', goalFile: '/tmp/invalid-goal.txt' },
      {
        readGoalFile: () => '## PROBLEM\nmissing required evidence\n',
        branch: () => 'main',
        spawnAgent: async () => { spawned = true; throw new Error('must not spawn'); },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.termination).toEqual({ kind: 'error', message: 'goal-lint-failed' });
    expect(result.output).toContain('ERROR [canonical-structure] missing required section: ## ACCEPTANCE CRITERIA');
    expect(result.output).toContain('ERROR [evidence-section]');
    expect(spawned).toBe(false);
  });

  test('resolves a relative goal file against the launch cwd rather than process cwd', async () => {
    const launchCwd = mkdtempSync(join(tmpdir(), 'monad-launch-context-'));
    const relativeGoalFile = 'docs/goals/GOAL-relative.txt';
    mkdirSync(join(launchCwd, 'docs', 'goals'), { recursive: true });
    writeFileSync(join(launchCwd, relativeGoalFile), '## PROBLEM\nread from launch cwd but missing required evidence\n');
    expect(launchCwd).not.toBe(process.cwd());

    try {
      const result = await dispatchMonadAutopilotLaunch(
        { mission: 'implement safely', cwd: launchCwd, goalFile: relativeGoalFile },
        { branch: () => 'main' },
      );

      expect(result.output).toContain('ERROR [evidence-section]');
      expect(result.termination).toEqual({ kind: 'error', message: 'goal-lint-failed' });
    } finally {
      rmSync(launchCwd, { recursive: true, force: true });
    }
  });

  test('warns for non-blocking canonical-section omissions and blocks reversals before spawning', async () => {
    let spawnedForMissing = false;
    const missing = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely', goalFile: '/tmp/missing.txt' },
      {
        readGoalFile: () => canonicalGoal().replace('## 답하지 못하는 것\nunknowns\n\n', ''),
        branch: () => 'main',
        spawnAgent: async () => { spawnedForMissing = true; throw new Error('missing warning did not block launch'); },
      },
    );
    let spawnedForReversed = false;
    const reversed = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely', goalFile: '/tmp/reversed.txt' },
      {
        readGoalFile: () => canonicalGoal().replace('## WHAT TO BUILD\nbuild\n\n## ACCEPTANCE CRITERIA\ncriteria', '## ACCEPTANCE CRITERIA\ncriteria\n\n## WHAT TO BUILD\nbuild'),
        branch: () => 'main',
        spawnAgent: async () => { spawnedForReversed = true; throw new Error('must not spawn'); },
      },
    );

    expect(spawnedForMissing).toBe(true);
    expect(missing.output).toContain('missing warning did not block launch');
    expect(missing.diagnostics.map((finding) => `${finding.level} [${finding.tag}] ${finding.message}`)).toContain('WARN [canonical-structure] missing required section: ## 답하지 못하는 것');
    expect(missing.diagnostics[0]?.check).toBe('missing-required-section');
    expect(missing.output).not.toContain('goal-lint-failed');
    expect(formatDiagnosticOutput(missing.diagnostics)).toContain('WARN [canonical-structure] missing required section: ## 답하지 못하는 것 — origin: nine required sections blocked handwritten goals');
    expect(spawnedForReversed).toBe(false);
    expect(reversed.output).toContain('ERROR [canonical-structure] required sections must appear in canonical order:');
    expect(reversed.output).toContain('origin: nine required sections blocked handwritten goals');
  });

  test('keeps independent section-order reversals blocking when optional canonical sections are missing', async () => {
    let spawned = false;
    const document = canonicalGoal()
      .replace('## 답하지 못하는 것\nunknowns\n\n', '')
      .replace('## WHAT TO BUILD\nbuild\n\n## ACCEPTANCE CRITERIA\ncriteria', '## ACCEPTANCE CRITERIA\ncriteria\n\n## WHAT TO BUILD\nbuild');
    const result = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely', goalFile: '/tmp/missing-and-reversed.txt' },
      {
        readGoalFile: () => document,
        branch: () => 'main',
        spawnAgent: async () => { spawned = true; throw new Error('must not spawn'); },
      },
    );

    expect(spawned).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.termination).toEqual({ kind: 'error', message: 'goal-lint-failed' });
    expect(formatDiagnosticOutput(result.diagnostics)).toContain('WARN [canonical-structure] missing required section: ## 답하지 못하는 것 — origin: nine required sections blocked handwritten goals');
    expect(result.output).toContain('ERROR [canonical-structure] required sections must appear in canonical order:');
    expect(result.output).toContain('origin: nine required sections blocked handwritten goals');
    expect(result.diagnostics.find((finding) => finding.check === 'required-section-order')?.orderCause).toBe('present-section-order');
  });

  test('allows a canonical goal and preserves non-blocking warnings in diagnostics', async () => {
    let spawned = false;
    const result = await dispatchMonadAutopilotLaunch(
      { mission: 'implement safely', goalFile: '/tmp/valid-goal.txt' },
      {
        readGoalFile: () => canonicalGoal(`${'x'.repeat(1801)}\n\`\` damage`),
        branch: () => 'feature/goal-lint',
        spawnAgent: async () => { spawned = true; throw new Error('existing spawn path reached'); },
      },
    );

    expect(spawned).toBe(true);
    expect(result.output).toContain('existing spawn path reached');
    expect(result.termination).toEqual({ kind: 'error', message: 'existing spawn path reached' });
    expect(result.diagnostics.map((finding) => finding.tag)).toEqual(['boundary-size', 'launch-branch', 'shell-damage']);
  });
});
