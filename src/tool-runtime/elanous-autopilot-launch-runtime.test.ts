// PLAN-codex-app-server-hermes-parity §5 Phase H1·6b test —
// dispatchElanousAutopilotLaunch args validation + clamping + factory
// inject. The integration path (real ACP agent spawn + AutopilotLoop
// Driver execution) is covered by dogfood; here we focus on the
// surface contract.

import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchElanousAutopilotLaunch,
  elanousAutopilotLaunchRuntime,
  buildElanousAutopilotLaunchTool,
  spawnElanousAutopilotAgent,
} from './elanous-autopilot-launch-runtime.js';
import type { AcpAgent } from '../acp/client.js';
import { AcpAgentManager } from '../acp/agent-manager.js';
import { REQUIRED_BLOCKS, lintGoalFile } from '../self-implement/goal-author.js';

// Eight execution-path failures below were stale-fixture cases: canonical title/metadata and heading order are required, so the former fixture stopped at lint before its asserted runtime branch.
// Sections are generated from REQUIRED_BLOCKS so a later contract addition cannot leave this fixture behind again.
const GOAL_SECTION_BODIES: Partial<Record<(typeof REQUIRED_BLOCKS)[number], string>> = {
  '## PROBLEM': 'problem',
  '## WHAT TO BUILD': 'build',
  '## ACCEPTANCE CRITERIA': 'criteria',
  '## REQUIRED EVIDENCE': '- [proof] check',
  '## TRACED PATHS': 'paths',
  '## SCOPE BOUNDARY': 'short',
  '## 불변식': 'invariants',
  '## 판정 신호': 'signals',
};

function sectionBody(heading: string): string {
  return GOAL_SECTION_BODIES[heading as (typeof REQUIRED_BLOCKS)[number]] ?? 'placeholder';
}

function goalSectionsFromContract(blocks: readonly string[]): string {
  return blocks.map((heading) => `${heading}\n${sectionBody(heading)}\n`).join('\n');
}

const validGoalFile = `Autopilot launch runtime fixture
- GoalId: f06880c5c21bf0e1
- RootIntent: exercise launch runtime contracts
- GoalType: implement

${goalSectionsFromContract(REQUIRED_BLOCKS)}`;

const validGoalLintDeps = {
  readGoalFile: () => validGoalFile,
  branch: () => 'main',
  readReferencedFile: () => ({ kind: 'ok' as const, contents: 'present' }),
};

const tracedGoalFile = (path: string) => validGoalFile.replace('## TRACED PATHS\npaths', `## TRACED PATHS\n- ${path}`);

describe('validGoalFile · contract-generated fixture', () => {
  test('fixture fills REQUIRED_BLOCKS so lintGoalFile reports no blocking findings', () => {
    const headings = [...validGoalFile.matchAll(/^## .+$/gm)].map((match) => match[0]);
    expect(headings).toEqual([...REQUIRED_BLOCKS]);
    expect(goalSectionsFromContract([...REQUIRED_BLOCKS, '## extra-grown-section'])).toContain('## extra-grown-section\nplaceholder\n');

    const findings = lintGoalFile(validGoalFile, 'main');
    expect(findings.filter((finding) => finding.level === 'ERROR')).toEqual([]);
  });
});

describe('dispatchElanousAutopilotLaunch · input validation', () => {
  test('missing mission → error termination + no agent spawn', async () => {
    let spawned = 0;
    const r = await dispatchElanousAutopilotLaunch(
      {},
      {
        spawnAgent: async () => {
          spawned += 1;
          return {} as AcpAgent;
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.termination.kind).toBe('error');
    expect((r.termination as { message?: string }).message).toBe(
      'mission-required',
    );
    expect(r.iterations).toBe(0);
    expect(spawned).toBe(0);
  });

  test('whitespace-only mission → same error path', async () => {
    let spawned = 0;
    const r = await dispatchElanousAutopilotLaunch(
      { mission: '   ' },
      {
        spawnAgent: async () => {
          spawned += 1;
          return {} as AcpAgent;
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(spawned).toBe(0);
  });
});

describe('dispatchElanousAutopilotLaunch · factory failure path', () => {
  // Stale fixture: missing GoalType preempted the spawn-failure branch; the canonical metadata restores this test's original branch.
  test('spawn throw surfaces as termination.kind=error', async () => {
    const r = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-valid.txt' },
      {
        ...validGoalLintDeps,
        spawnAgent: async () => {
          throw new Error('spawn failed');
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.termination.kind).toBe('error');
    expect((r.termination as { message?: string }).message).toContain(
      'spawn failed',
    );
    expect(r.iterations).toBe(0);
    expect(r.text).toBe('');
  });

  // Stale fixture: missing GoalType preempted the new-session error branch; the fixture now reaches the unchanged runtime catch path.
  test('agent.newSession throw is caught', async () => {
    const r = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-valid.txt' },
      {
        ...validGoalLintDeps,
        spawnAgent: async () => {
          return {
            newSession: async () => {
              throw new Error('session-init-failed');
            },
            stop: async () => {},
          } as unknown as AcpAgent;
        },
      },
    );
    expect(r.ok).toBe(false);
    expect((r.termination as { message?: string }).message).toContain(
      'session-init-failed',
    );
  });
});

describe('dispatchElanousAutopilotLaunch · goal-file traced paths', () => {
  test('blocks before spawn for a missing traced file', async () => {
    let spawned = 0;
    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-traced.txt' },
      {
        readGoalFile: () => tracedGoalFile('src/missing.ts — absent'),
        branch: () => 'main',
        readReferencedFile: () => ({ kind: 'missing' }),
        spawnAgent: async () => {
          spawned += 1;
          return {} as AcpAgent;
        },
      },
    );

    expect(spawned).toBe(0);
    expect(result.termination).toEqual({ kind: 'error', message: 'goal-lint-failed' });
    expect(result.output).toContain('ERROR [traced-path] traced path does not exist: src/missing.ts');
  });

  test('blocks before spawn for an out-of-range traced line', async () => {
    let spawned = 0;
    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-traced.txt' },
      {
        readGoalFile: () => tracedGoalFile('src/present.ts:2 — invalid line'),
        branch: () => 'main',
        readReferencedFile: () => ({ kind: 'ok', contents: 'one' }),
        spawnAgent: async () => {
          spawned += 1;
          return {} as AcpAgent;
        },
      },
    );

    expect(spawned).toBe(0);
    expect(result.termination).toEqual({ kind: 'error', message: 'goal-lint-failed' });
    expect(result.output).toContain('ERROR [traced-path] traced path line 2 is out of range: src/present.ts');
  });

  // Stale fixture: missing GoalType converted the intended WARN-only diagnostic path into an ERROR block before spawn.
  test('returns WARN diagnostics without blocking spawn', async () => {
    let spawned = 0;
    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-warn.txt' },
      {
        ...validGoalLintDeps,
        branch: () => 'feature/warn',
        spawnAgent: async () => {
          spawned += 1;
          throw new Error('spawn reached');
        },
      },
    );

    expect(spawned).toBe(1);
    expect(result.diagnostics).toEqual([expect.objectContaining({ level: 'WARN', tag: 'launch-branch' })]);
    expect((result.termination as { message?: string }).message).toContain('spawn reached');
  });

  // Stale fixture: missing GoalType blocked lint before the valid traced-path branch could prove it reaches spawn.
  test('permits an existing traced file to reach spawn', async () => {
    let spawned = 0;
    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'do thing', goalFile: 'GOAL-traced.txt' },
      {
        readGoalFile: () => tracedGoalFile('src/present.ts:1 — valid line'),
        branch: () => 'main',
        readReferencedFile: () => ({ kind: 'ok', contents: 'one' }),
        spawnAgent: async () => {
          spawned += 1;
          throw new Error('spawn reached');
        },
      },
    );

    expect(spawned).toBe(1);
    expect((result.termination as { message?: string }).message).toContain('spawn reached');
  });

  // 리뷰 should-fix — 위 셋은 전부 reader 를 주입해서, **기본 배선이 실제로 붙었는지**는
  //   확인하지 못한다. 여기서는 주입하지 않고 진짜 파일시스템으로 본다.
  // Stale fixture: missing GoalType preempted the present-file leg before the default reader's execution path reached spawn.
  test('wires the default repository reader when no override is supplied', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autopilot-launch-traced-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'present.ts'), 'one\n');
      let spawned = 0;
      const spawnAgent = async () => { spawned += 1; throw new Error('spawn reached'); };

      const missing = await dispatchElanousAutopilotLaunch(
        { mission: 'do thing', goalFile: 'GOAL-traced.txt', cwd: root },
        { readGoalFile: () => tracedGoalFile('src/missing.ts — absent'), branch: () => 'main', spawnAgent },
      );
      expect(spawned).toBe(0);
      expect(missing.output).toContain('ERROR [traced-path] traced path does not exist: src/missing.ts');

      const outside = await dispatchElanousAutopilotLaunch(
        { mission: 'do thing', goalFile: 'GOAL-traced.txt', cwd: root },
        { readGoalFile: () => tracedGoalFile('../escape.ts — outside'), branch: () => 'main', spawnAgent },
      );
      expect(spawned).toBe(0);
      expect(outside.output).toContain('ERROR [traced-path] traced path is outside repository: ../escape.ts');

      // 반증 입력: 실재하는 파일은 기본 reader 로도 통과해 spawn 에 닿는다 — 전부 막는 것이 아니다.
      const present = await dispatchElanousAutopilotLaunch(
        { mission: 'do thing', goalFile: 'GOAL-traced.txt', cwd: root },
        { readGoalFile: () => tracedGoalFile('src/present.ts:1 — valid line'), branch: () => 'main', spawnAgent },
      );
      expect(spawned).toBe(1);
      expect((present.termination as { message?: string }).message).toContain('spawn reached');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dispatchElanousAutopilotLaunch · cap clamping', () => {
  // Stale fixture: missing GoalType prevented this test from reaching the clamped execution branch and its injected spawn failure.
  test('out-of-range maxIterations falls back to default (no error per se)', async () => {
    // We can't observe maxIterations from outside without running the
    // driver. Instead, test the validation path's no-throw contract.
    const r = await dispatchElanousAutopilotLaunch(
      {
        mission: 'do thing',
        maxIterations: 9999,
        maxWallClockMs: 1, // below MIN_WALLCLOCK_MS → fallback
        maxOutputChars: 0, // below MIN_OUTPUT_CHARS → fallback
        goalFile: 'GOAL-valid.txt',
      },
      {
        ...validGoalLintDeps,
        spawnAgent: async () => {
          throw new Error('skip-actual-run');
        },
      },
    );
    // We don't crash on out-of-range values — the call reaches the
    // spawn factory (which then throws). The point is no validation
    // exception bubbled.
    expect(r.ok).toBe(false);
    expect((r.termination as { message?: string }).message).toContain(
      'skip-actual-run',
    );
  });
});

describe('dispatchElanousAutopilotLaunch · manager ownership', () => {
  // Stale fixture: missing GoalType stopped lint before this disposal-rejection case reached the manager ownership branch.
  test('preserves the tool error result when dedicated manager disposal rejects', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    const manager = {
      getAgent: async () => agent,
      dispose: async () => { throw new Error('dispose-failed'); },
    } as unknown as AcpAgentManager;

    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'x', goalFile: 'GOAL-valid.txt' },
      { ...validGoalLintDeps, createAgentManager: () => manager },
    );
    expect(result.ok).toBe(false);
    expect((result.termination as { message?: string }).message).toContain('session-failed');
    expect(result.output).not.toContain('dispose-failed');
  });

  // Stale fixture: missing GoalType stopped lint before the execution-error branch could dispose the dedicated manager.
  test('disposes only its dedicated manager after an execution error', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    let disposed = 0;
    const manager = {
      getAgent: async () => agent,
      dispose: async () => { disposed += 1; },
    } as unknown as AcpAgentManager;

    const result = await dispatchElanousAutopilotLaunch(
      { mission: 'x', goalFile: 'GOAL-valid.txt' },
      { ...validGoalLintDeps, createAgentManager: () => manager },
    );
    expect(result.ok).toBe(false);
    expect((result.termination as { message?: string }).message).toContain('session-failed');
    expect(disposed).toBe(1);
  });
});

describe('spawnElanousAutopilotAgent · canonical acquisition', () => {
  test('routes codex-app-server through the canonical manager', async () => {
    const agent = { start: async () => {}, stop: async () => {} } as unknown as AcpAgent;
    const calls: Array<{ backend: string; cwd?: string }> = [];
    const acquired = await spawnElanousAutopilotAgent(
      'codex-app-server',
      '/repo',
      undefined,
      { getAgent: async (backend, opts) => {
        calls.push({ backend, cwd: opts?.cwd });
        return agent;
      } },
    );

    expect(calls).toEqual([{ backend: 'codex-app-server', cwd: '/repo' }]);
    expect(acquired).toBe(agent);
  });

  test('stops an injected agent and preserves its start error', async () => {
    let stopped = 0;
    const agent = {
      start: async () => { throw new Error('start-failed'); },
      stop: async () => { stopped += 1; },
    } as unknown as AcpAgent;

    await expect(spawnElanousAutopilotAgent('codex-app-server', '/repo', () => agent)).rejects.toThrow('start-failed');
    expect(stopped).toBe(1);
  });

  test('honors an injected factory instead of the manager', async () => {
    const agent = { start: async () => {}, stop: async () => {} } as unknown as AcpAgent;
    let injected = 0;
    let managerCalls = 0;
    const acquired = await spawnElanousAutopilotAgent(
      'codex-app-server',
      '/repo',
      () => { injected += 1; return agent; },
      { getAgent: async () => { managerCalls += 1; return agent; } },
    );

    expect(injected).toBe(1);
    expect(managerCalls).toBe(0);
    expect(acquired).toBe(agent);
  });
});

describe('elanousAutopilotLaunchRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousAutopilotLaunchRuntime.id).toBe('elanous_autopilot_launch');
    expect(elanousAutopilotLaunchRuntime.spec.name).toBe('elanous_autopilot_launch');
  });

  // ⚠️ 2026-08-01 계약 변경([T] 교차 리뷰): goalFile 은 **선택**이다.
  //   필수로 두면 기존 MCP 호출자가 전부 깨진다. 주면 린트, 안 주면 종전대로.
  test('buildElanousAutopilotLaunchTool requires mission (goalFile 은 선택)', () => {
    const spec = buildElanousAutopilotLaunchTool();
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toEqual(['mission']);
  });
});

// ⛔⭐⭐ 탈출구 회귀 가드 (2026-08-01 · [T] 교차 리뷰 지적).
//   `#6363` 이 goalFile 을 **필수**로 만들어 기존 MCP 호출자를 전부 깨뜨릴 뻔했다.
//   ⇒ 주면 린트(ERROR=차단), 안 주면 종전대로. `#6348` 의 --allow-no-evidence 와 같은 형태.
describe('goalFile 탈출구', () => {
  test('스키마에서 goalFile 은 필수가 아니다', () => {
    const spec = buildElanousAutopilotLaunchTool();
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toEqual(['mission']);
  });
  test('설명의 기본 백엔드가 codex 다 (JDG-S9 · 문서가 낡지 않는다)', () => {
    const spec = buildElanousAutopilotLaunchTool();
    expect(JSON.stringify(spec)).toContain('codex');
    expect(JSON.stringify(spec)).not.toContain("default 'claude'");
  });
});
