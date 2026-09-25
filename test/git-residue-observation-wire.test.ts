import { afterEach, beforeEach, expect, test } from 'bun:test';
import { runDevPipeline, type DevPipelineSpec } from '../src/self-dev/dev-pipeline.js';
import type { SelfImplementResult, SelfImplementSeams } from '../src/self-implement/orchestrator.js';
import { debug } from '../src/debug/log.js';

const selfResult = { ok: true } as unknown as SelfImplementResult;
const spec: DevPipelineSpec = {
  input: { text: 'observe one snapshot' },
  gitResiduePath: '/worktree/observed-once',
};

test('plan observer consumes a CLI-provided snapshot without independently observing Git', async () => {
  let calls = 0;
  await runDevPipeline({ ...spec, gitResidueSnapshot: { path: '/worktree/observed-once', observation: { state: 'observed', residues: ['cherry-pick'] } } }, {
    observeGitResidue: async () => { calls++; return { state: 'observed', residues: [] }; },
    runSelfImplement: async () => selfResult,
    buildSelfImplementSeams: () => ({} as SelfImplementSeams),
  });
  expect(calls).toBe(0);
});

test('plan observer obtains exactly one snapshot when the CLI did not provide one', async () => {
  let calls = 0;
  await runDevPipeline(spec, {
    observeGitResidue: async (path) => {
      calls++;
      expect(path).toBe('/worktree/observed-once');
      return { state: 'observed', residues: ['cherry-pick'] };
    },
    runSelfImplement: async () => selfResult,
    buildSelfImplementSeams: () => ({} as SelfImplementSeams),
  });
  expect(calls).toBe(1);
});

// ⛔ 회귀 고정 — 중복 관측을 없애면서 **CLI 가 내던 필드까지 지워진 적이 있다**(무인 리뷰 must-fix).
//    조회는 한 번이되 **행 하나가 양쪽 필드를 다 실어야** 한다. 그 계약을 payload 로 못 박는다.
let savedMirror = false;
beforeEach(() => { savedMirror = debug.isMirrorEnabled(); });
afterEach(() => { if (savedMirror) debug.enable(); else debug.disable(); });

// ⛔ 회귀 고정 — 관측이 preflight 보다 **앞**이어야 한다. 종전엔 골 파일 읽기가 먼저라
//    그 단계가 던지면 잔여가 있어도 행이 안 남았고, 그것이 이 PR 이 없애려는 실패 형태였다.
test('the residue row survives a preflight failure — exactly one row, then the error', async () => {
  debug.enable();
  debug.clear();
  let threw = false;
  try {
    await runDevPipeline({ input: { file: '/nonexistent/goal.txt' }, gitResiduePath: '/worktree/observed-once' }, {
      observeGitResidue: async () => ({ state: 'observed', residues: ['index-lock'] }),
      runSelfImplement: async () => selfResult,
      buildSelfImplementSeams: () => ({} as SelfImplementSeams),
    });
  } catch { threw = true; }
  expect(threw).toBe(true);                                    // 오류는 그대로 전파된다
  const rows = debug.events(50).filter((e) => e.category === 'dev-pipeline' && e.event === 'plan');
  expect(rows.length).toBe(1);                                 // 그래도 행은 정확히 하나
  expect(rows[0]!.data).toMatchObject({ gitResidueState: 'observed', gitResiduePath: '/worktree/observed-once' });
});

// ⛔ 회귀 — `parallel` 은 골 읽기 전에 **일찍 반환**한다. 관측이 그 뒤에 있으면 행이 0개다.
test('a parallel dispatch emits the row before dispatching, exactly once', async () => {
  debug.enable();
  debug.clear();
  let rowsWhenDispatched = -1;
  const result = await runDevPipeline(
    { input: { text: '' }, parallel: { goals: ['g1'] }, gitResiduePath: '/worktree/observed-once' } as DevPipelineSpec,
    {
      observeGitResidue: async () => ({ state: 'observed', residues: ['merge'] }),
      // ⛔ 오류를 삼키지 않는다 — 디스패처가 **실제로 불렸는지**와 **그때 이미 행이 있었는지**를 본다.
      orchestrateSelfDev: (async () => {
        rowsWhenDispatched = debug.events(50).filter((e) => e.category === 'dev-pipeline' && e.event === 'plan').length;
        return { ok: true } as never;
      }) as never,
    },
  );
  expect(result.kind).toBe('parallel');
  expect(rowsWhenDispatched).toBe(1);          // 디스패치 시점에 이미 찍혀 있었다(사전 관측)
  const rows = debug.events(50).filter((e) => e.category === 'dev-pipeline' && e.event === 'plan');
  expect(rows.length).toBe(1);                 // 끝난 뒤에도 하나뿐(단회 가드)
  expect(rows[0]!.data).toMatchObject({ gitResidueState: 'observed', dispatch: 'parallel' });
});

// ⛔ 회귀 — 주입된 관측기가 던져도 행은 남아야 한다(조회가 `try` 안이라는 계약).
test('an observer failure still leaves exactly one row', async () => {
  debug.enable();
  debug.clear();
  let threw = false;
  try {
    await runDevPipeline({ ...spec, input: { text: 'x' } }, {
      observeGitResidue: async () => { throw new Error('observer down'); },
      runSelfImplement: async () => selfResult,
      buildSelfImplementSeams: () => ({} as SelfImplementSeams),
    });
  } catch { threw = true; }
  expect(threw).toBe(true);
  const rows = debug.events(50).filter((e) => e.category === 'dev-pipeline' && e.event === 'plan');
  expect(rows.length).toBe(1);
});

// ⛔ 회귀 — 계획 자체가 던져도 행은 남아야 한다(관측이 계획보다 앞이라는 계약).
test('a planning failure still leaves exactly one residue row', async () => {
  debug.enable();
  debug.clear();
  let threw = false;
  try {
    await runDevPipeline({ input: { text: '' }, gitResiduePath: '/worktree/observed-once' } as DevPipelineSpec, {
      observeGitResidue: async () => ({ state: 'unreadable' }),
    });
  } catch { threw = true; }
  expect(threw).toBe(true);
  const rows = debug.events(50).filter((e) => e.category === 'dev-pipeline' && e.event === 'plan');
  expect(rows.length).toBe(1);
  expect(rows[0]!.data).toMatchObject({ gitResidueState: 'unreadable' });
});

test('the single plan row carries both the pipeline fields and the residue fields', async () => {
  debug.enable();
  debug.clear();
  await runDevPipeline({ ...spec, runId: 'run-wire-1', gitResidueSnapshot: { path: '/worktree/observed-once', observation: { state: 'observed', residues: ['cherry-pick'] } } }, {
    observeGitResidue: async () => ({ state: 'observed', residues: [] }),
    runSelfImplement: async () => selfResult,
    buildSelfImplementSeams: () => ({} as SelfImplementSeams),
  });
  const row = debug.events(50).find((e) => e.category === 'dev-pipeline' && e.event === 'plan');
  expect(row).toBeDefined();
  // 잔여 축(이 PR 이 더한 것)
  expect(row!.data).toMatchObject({ gitResiduePath: '/worktree/observed-once', gitResidueState: 'observed' });
  // 파이프라인 축(종전 CLI 가 내던 것 — 지워졌던 자리)
  for (const key of ['runId', 'dispatch', 'executor', 'wired', 'completion', 'nestDepth']) {
    expect(Object.keys(row!.data ?? {})).toContain(key);
  }
});
