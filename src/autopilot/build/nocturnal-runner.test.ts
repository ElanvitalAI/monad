// Self-Evolution SE4 야간 러너 + 무결성 게이트 + config 격리 가드 단위테스트.
import { describe, test, expect } from 'bun:test';
import { runIntegrityGate, renderGateEvidence, type RunCmd } from './integrity-gate.js';
import { runNocturnalOne, runNocturnal, buildIsolatedLaunchArgs, type NocturnalDeps } from './nocturnal-runner.js';
import { planIsolatedInstance, PRODUCTION_PORT } from './isolated-instance.js';
import { makeNocturnalDeps } from './nocturnal-deps.js';
import type { BuildTarget } from './build-target.js';
import type { PrManager } from '../pr-manager.js';

const REPO = '/Users/x/source/leader/monad-agent';
const plan = planIsolatedInstance(REPO, 'demo');
const target: BuildTarget = {
  id: 'p1', slug: 'demo', title: '데모 기능',
  planPath: '/tmp/elanous-se/proposals/p1.md',
};

describe('integrity-gate', () => {
  test('전 스텝 pass → passed', async () => {
    const runCmd: RunCmd = async () => ({ code: 0, stdout: 'ok', stderr: '', timedOut: false });
    const r = await runIntegrityGate('/wt', { steps: ['test', 'typecheck'], runCmd });
    expect(r.passed).toBe(true);
    expect(r.steps.every(s => s.ok)).toBe(true);
  });
  test('한 스텝 fail → passed=false + 증거', async () => {
    const runCmd: RunCmd = async (_c, args) => args.includes('tsc')
      ? { code: 2, stdout: '', stderr: 'TS error x', timedOut: false }
      : { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    const r = await runIntegrityGate('/wt', { steps: ['test', 'typecheck'], runCmd });
    expect(r.passed).toBe(false);
    expect(r.steps.find(s => s.name === 'typecheck')!.ok).toBe(false);
    expect(renderGateEvidence(r)).toContain('❌ FAIL');
  });
  test('timeout → fail', async () => {
    const runCmd: RunCmd = async () => ({ code: 124, stdout: '', stderr: '', timedOut: true });
    expect((await runIntegrityGate('/wt', { steps: ['test'], runCmd })).passed).toBe(false);
  });
  test('testArgs → test 스텝 스코프 override(SE6 curated 서브셋)', async () => {
    let seen: string[] = [];
    const runCmd: RunCmd = async (_c, args) => { seen = args; return { code: 0, stdout: 'ok', stderr: '', timedOut: false }; };
    await runIntegrityGate('/wt', { steps: ['test'], runCmd, testArgs: ['src/autopilot/'] });
    expect(seen).toEqual(['test', 'src/autopilot/']);
  });
  test('testArgs 없으면 전체 bun test', async () => {
    let seen: string[] = [];
    const runCmd: RunCmd = async (_c, args) => {
      seen = args;
      return { code: 0, stdout: '1 pass\nRan 1 test across 1 file.', stderr: '', timedOut: false };
    };
    await runIntegrityGate('/wt', { steps: ['test'], runCmd });
    expect(seen).toEqual(['test']);
  });

  test('필터 없이 직전 라운드보다 pass가 줄면 ranFiles가 남아도 실패하고 두 수를 summary에 싣는다', async () => {
    const runCmd: RunCmd = async () => ({
      code: 0, stdout: '4 pass\n0 fail\nRan 4 tests across 1 file.', stderr: '', timedOut: false,
    });
    const r = await runIntegrityGate('/wt', { steps: ['test'], previousPassCount: 5, runCmd });
    expect(r.passed).toBe(false);
    expect(r.steps[0]).toMatchObject({ name: 'test', ok: false });
    expect(r.steps[0]?.summary).toContain('previous-pass=5');
    expect(r.steps[0]?.summary).toContain('current-pass=4');
    expect(r.testPassCount).toBe(4);
  });

  test('직전 pass가 없는 첫 라운드와 같은 pass 수는 감소 비교로 실패하지 않는다', async () => {
    const runCmd: RunCmd = async () => ({
      code: 0, stdout: '5 pass\n0 fail\nRan 5 tests across 1 file.', stderr: '', timedOut: false,
    });
    expect((await runIntegrityGate('/wt', { steps: ['test'], runCmd })).passed).toBe(true);
    expect((await runIntegrityGate('/wt', { steps: ['test'], previousPassCount: 5, runCmd })).passed).toBe(true);
  });

  // ⛔⭐ 무인 리뷰 must-fix(2026-08-04): 종전 판은 «감소했을 때만» 두 수를 실어서
  //   「비교했는데 통과」와 「비교 자체를 안 함」이 산출에서 구별되지 않았다.
  //   ⇒ #6925 와 같은 형태 — 도구가 「무엇을 봤는지」를 말해야 「아무것도 안 봤다」가 통과로 안 읽힌다.
  test('통과할 때도 산출이 「무엇과 비교했는지」를 말한다 — 비교함과 비교 안 함이 갈린다', async () => {
    const runCmd: RunCmd = async () => ({
      code: 0, stdout: '5 pass\n0 fail\nRan 5 tests across 1 file.', stderr: '', timedOut: false,
    });
    const compared = await runIntegrityGate('/wt', { steps: ['test'], previousPassCount: 5, runCmd });
    expect(compared.passed).toBe(true);
    expect(compared.steps[0]?.summary).toContain('previous-pass=5');
    expect(compared.steps[0]?.summary).toContain('current-pass=5');

    const notCompared = await runIntegrityGate('/wt', { steps: ['test'], runCmd });
    expect(notCompared.passed).toBe(true);
    expect(notCompared.steps[0]?.summary).toContain('current-pass=5');
    // ⛔ 기준이 «없었다»는 사실 자체를 싣는다 — 침묵은 「비교했고 통과」와 구별되지 않는다.
    expect(notCompared.steps[0]?.summary).toContain('previous-pass=none');
  });
});

describe('★ config 격리 하드가드 (buildIsolatedLaunchArgs)', () => {
  test('격리 plan → --config-dir/--test-state-dir 포함', () => {
    const args = buildIsolatedLaunchArgs(plan);
    expect(args).toContain('--config-dir');
    expect(args).toContain(plan.configDir);
    expect(args).toContain('--test-state-dir');
    expect(args).toContain(String(plan.port));
    // 격리 config-dir 은 worktree 하위(정식 아님).
    expect(plan.configDir).toContain('.worktrees');
  });
  test('정식 ~/.elanous config-dir → throw(메인 무오염 보증)', () => {
    const evil = { ...plan, configDir: `${process.env.HOME}/.elanous`, worktreePath: `${process.env.HOME}/.elanous`, branch: 'se/x' };
    expect(() => buildIsolatedLaunchArgs(evil as any)).toThrow();
  });
  test('정식 포트 → throw', () => {
    expect(() => buildIsolatedLaunchArgs({ ...plan, port: PRODUCTION_PORT })).toThrow(/정식 포트/);
  });
});

describe('runNocturnal — 오케스트레이션', () => {
  const baseDeps = (over: Partial<NocturnalDeps> = {}): NocturnalDeps => ({
    createInstance: () => plan,
    implement: async () => ({ changed: true, summary: '구현함' }),
    gate: () => ({ passed: true, steps: [{ name: 'test', ok: true, skipped: false, summary: 'pass' }], log: '' }),
    makePr: () => ({ url: 'https://github.com/x/pr/1' }),
    dispose: () => {},
    markBuilt: () => {},
    ...over,
  });

  test('build disarmed → skeleton(집행 0)', async () => {
    let implCalled = false;
    const r = await runNocturnalOne(target, false, baseDeps({ implement: async () => { implCalled = true; return { changed: true, summary: '' }; } }));
    expect(r.status).toBe('disarmed');
    expect(implCalled).toBe(false);
  });

  test('armed + 구현 + 게이트 통과 → built + PR', async () => {
    let built = '';
    const r = await runNocturnalOne(target, true, baseDeps({ markBuilt: (_id, note) => { built = note; } }));
    expect(r.status).toBe('built');
    expect(r.prUrl).toContain('/pr/1');
    expect(built).toContain('/pr/1');
  });

  test('게이트 실패 → gate-failed + dispose', async () => {
    let disposed = false;
    const r = await runNocturnalOne(target, true, baseDeps({
      gate: () => ({ passed: false, steps: [{ name: 'test', ok: false, skipped: false, summary: 'fail' }], log: '' }),
      dispose: () => { disposed = true; },
    }));
    expect(r.status).toBe('gate-failed');
    expect(disposed).toBe(true);
  });

  test('★ 변경 불필요(no-op·이미 구현됨) → no-change PASS (대표 2026-07-12·껍데기 실패 아님)', async () => {
    const r = await runNocturnalOne(target, true, baseDeps({ implement: async () => ({ changed: false, summary: '실제 코드 변경 없음(no-op)' }) }));
    expect(r.status).toBe('no-change'); // 오류 아닌 무변경 = 정직한 no-op(이미 구현됨)
  });

  test('★ 구현 오류(delegate 예외) → impl-failed (대표 2026-07-12·no-op 와 구분)', async () => {
    const r = await runNocturnalOne(target, true, baseDeps({ implement: async () => ({ changed: false, error: true, summary: 'delegate 오류' }) }));
    expect(r.status).toBe('impl-failed');
  });

  test('★ 실제 변경 있는데 PR 생성 실패(makePr null) → pr-failed (대표 2026-07-12·껍데기 built 금지)', async () => {
    const r = await runNocturnalOne(target, true, baseDeps({
      implement: async () => ({ changed: true, summary: '2 파일 변경' }),
      makePr: () => null, // 커밋/push/gh 실패
    }));
    expect(r.status).toBe('pr-failed');
  });

  test('★ makePr no-op(nothing-to-commit·이미 반영됨) → no-change PASS (대표 2026-07-21·705308 근본·pr-failed 오힐 종식)', async () => {
    let disposed = false;
    const r = await runNocturnalOne(target, true, baseDeps({
      implement: async () => ({ changed: true, summary: '2 파일 변경' }), // impl 은 changed 라 makePr 도달
      makePr: () => ({ noop: true }), // 그러나 커밋할 순변경 없음(이미 main 에 반영) = 정직 no-op
      dispose: () => { disposed = true; },
    }));
    expect(r.status).toBe('no-change'); // pr-failed 아님 — 억울한 실패·예산 오힐 종식
    expect(disposed).toBe(true); // worktree 정리
  });

  test('★ 비평 FAIL → gate-failed 차단(대표 2026-07-12·dead-code built 위증 금지)', async () => {
    let prCalled = false, disposed = false;
    const r = await runNocturnalOne(target, true, baseDeps({
      critique: async () => ({ verdict: 'fail', outOfScope: [], goodhartSuspect: true, findings: ['미연결 dead-code(타입 stub만)'] }),
      makePr: () => { prCalled = true; return { url: 'https://github.com/x/pr/1' }; },
      dispose: () => { disposed = true; },
    }));
    expect(r.status).toBe('gate-failed'); // built 위증 아님 — 정직한 실패
    expect(prCalled).toBe(false); // PR 도 안 만듦(미완)
    expect(disposed).toBe(true);
    expect(r.critique?.verdict).toBe('fail');
    expect(r.next).toContain('비평 FAIL');
  });

  test('★ 비평 WARN 은 기존대로 built(경미·사람 재반영 판단·대표 2026-07-12)', async () => {
    const r = await runNocturnalOne(target, true, baseDeps({
      critique: async () => ({ verdict: 'warn', outOfScope: ['x.ts'], goodhartSuspect: false, findings: ['경미 범위밖'] }),
    }));
    expect(r.status).toBe('built'); // warn 은 차단 아님
    expect(r.critique?.verdict).toBe('warn');
  });

  test('★ SE5.2 불변 코어 위반 → core-violation(게이트 이전 차단·dispose)', async () => {
    let disposed = false, gated = false;
    const r = await runNocturnalOne(target, true, baseDeps({
      changedFiles: () => ['src/autopilot/arming.ts', 'src/foo.ts'], // arming.ts = 불변 코어
      gate: () => { gated = true; return { passed: true, steps: [], log: '' }; },
      dispose: () => { disposed = true; },
    }));
    expect(r.status).toBe('core-violation');
    expect(r.next).toContain('arming.ts');
    expect(disposed).toBe(true);
    expect(gated).toBe(false); // 게이트 도달 전 차단
  });

  test('불변 코어 무관 변경 → 정상 진행(built)', async () => {
    const r = await runNocturnalOne(target, true, baseDeps({
      changedFiles: () => ['src/some-feature.ts', 'docs/x.md'],
    }));
    expect(r.status).toBe('built');
  });

  // ⛔⭐⭐⭐ 무인 리뷰 must-fix(2026-08-04 · 2라운드): 종전 테스트는 이 자리에서
  //   「앞 타깃의 pass 수를 다음 타깃 게이트로 넘긴다」를 «정답으로» 고정하고 있었다.
  //   그런데 타깃마다 테스트 스코프가 다르므로 그 비교는 «서로 다른 것»을 견주는 것이고,
  //   갱신에 `passed` 조건이 없어 5→4 실패 뒤 기준이 4로 내려가는 하향 래칫까지 났다.
  //   ⇒ 기준 소유는 `makeNocturnalDeps` 의 «스코프별» 맵 한 곳이다(바로 아래 테스트가 그것을 문다).
  //   여기서는 그 반대 — ***오케스트레이터가 기준을 타깃 사이로 이어 나르지 «않는다»*** 를 고정한다.
  test('runNocturnal 은 타깃 사이로 pass 기준을 이어 나르지 않는다 — 스코프가 다르기 때문이다', async () => {
    const gateArgCounts: number[] = [];
    const gate = (...args: unknown[]) => {
      gateArgCounts.push(args.length);
      return { passed: true, testPassCount: 5, steps: [], log: '' };
    };
    const targets = [target, { ...target, id: 'p2', slug: 'demo-2' }];
    const results = await runNocturnal(targets, true, baseDeps({ gate }));
    expect(results.map((result) => result.status)).toEqual(['built', 'built']);
    // ⛔ 게이트는 plan «하나»만 받는다 — 기준을 인자로 넘기는 두 번째 계약이 남아 있으면 안 된다.
    expect(gateArgCounts).toEqual([1, 1]);
  });

  test('실제 makeNocturnalDeps 배선은 스코프별 마지막 성공 pass만 비교하고 실패 후 기준을 보존한다', async () => {
    const calls: Array<{ cwd: string; args?: string[]; previousPassCount?: number }> = [];
    const scopeFiles: Record<string, string[]> = {
      '/wt-a': ['src/a/feature.ts'],
      '/wt-b': ['src/b/feature.ts'],
      '/wt-c': ['src/a/retry.ts'],
    };
    const passes = [5, 3, 4, 4];
    const deps = makeNocturnalDeps({
      repoRoot: REPO,
      backend: 'test',
      // ⛔⭐ 기본 record 는 recordAutonomousActionSafe → openSurfaceEventsDb() 로 «실제 DB» 를 연다.
      //   무인 리뷰 must-fix(2026-08-04 · 4라운드) — 테스트가 저장소 부작용을 내면 안 된다.
      record: () => {},
      createInstance: async (slug) => ({ ...plan, slug, worktreePath: `/wt-${slug}`, configDir: `/wt-${slug}/.elanous-test` }),
      implement: async () => ({ changed: true, summary: '구현함' }),
      changedFiles: (worktreePath) => scopeFiles[worktreePath] ?? [],
      runIntegrityGate: async (cwd, options = {}) => {
        const currentPass = cwd === REPO ? 5 : passes.shift()!;
        calls.push({ cwd, args: options.testArgs, previousPassCount: options.previousPassCount });
        const regressed = options.previousPassCount !== undefined && currentPass < options.previousPassCount;
        return {
          passed: !regressed,
          testPassCount: currentPass,
          steps: [{ name: 'test', ok: !regressed, skipped: false, summary: regressed ? `fail: previous-pass=${options.previousPassCount} current-pass=${currentPass}` : 'pass' }],
          log: '',
        };
      },
      prManager: { upsertPr: () => ({ noop: true }) } as unknown as PrManager,
    });
    const targets = [
      { ...target, id: 'a', slug: 'a' },
      { ...target, id: 'b', slug: 'b' },
      { ...target, id: 'c', slug: 'c' },
      { ...target, id: 'd', slug: 'c' },
    ];
    const results = await runNocturnal(targets, true, deps);
    expect(calls.filter(({ cwd }) => cwd !== REPO).map(({ args, previousPassCount }) => ({ args, previousPassCount }))).toEqual([
      { args: ['src/autopilot/', 'src/a/'], previousPassCount: undefined },
      { args: ['src/autopilot/', 'src/b/'], previousPassCount: undefined },
      { args: ['src/autopilot/', 'src/a/'], previousPassCount: 5 },
      { args: ['src/autopilot/', 'src/a/'], previousPassCount: 5 },
    ]);
    expect(results.map(({ status }) => status)).toEqual(['pr-failed', 'pr-failed', 'gate-failed', 'gate-failed']);
    expect(results[2]?.evidence?.steps[0]?.summary).toContain('previous-pass=5 current-pass=4');
    expect(results[3]?.evidence?.steps[0]?.summary).toContain('previous-pass=5 current-pass=4');
  });

  // ⛔⭐⭐⭐ 무인 리뷰 must-fix(2026-08-04 · 3라운드): baseline 흡수 경로가 감소 판정을 삼켰다.
  //   그 흡수는 「base 가 이미 깨져 있으면 그 죄를 SE 변경에 씌우지 않는다」는 규칙인데,
  //   ***「통과 수가 줄었다」는 base 상태와 무관한 회귀***라 같은 저울에 올리면 안 된다.
  //   여기서는 base 가 «더 많이» 깨져 있어도 감소가 gate-failed 로 «유지»되는지를 문다.
  test('base 가 더 많이 깨져 있어도 통과 수 감소는 baseline 흡수에 삼켜지지 않는다', async () => {
    const scopeFiles: Record<string, string[]> = { '/wt-a': ['src/a/feature.ts'] };
    const passes = [5, 4];
    const deps = makeNocturnalDeps({
      repoRoot: REPO,
      backend: 'test',
      // ⛔⭐ 기본 record 는 recordAutonomousActionSafe → openSurfaceEventsDb() 로 «실제 DB» 를 연다.
      //   무인 리뷰 must-fix(2026-08-04 · 4라운드) — 테스트가 저장소 부작용을 내면 안 된다.
      record: () => {},
      createInstance: async (slug) => ({ ...plan, slug, worktreePath: `/wt-${slug}`, configDir: `/wt-${slug}/.elanous-test` }),
      implement: async () => ({ changed: true, summary: '구현함' }),
      changedFiles: (worktreePath) => scopeFiles[worktreePath] ?? [],
      runIntegrityGate: async (cwd, options = {}) => {
        // base(repoRoot)는 «5 fail» — worktree 보다 «더 많이» 깨져 있다.
        if (cwd === REPO) {
          return { passed: false, steps: [{ name: 'test', ok: false, skipped: false, summary: 'fail' }], log: '5 fail\n0 pass\nRan 5 tests across 1 file.' };
        }
        const currentPass = passes.shift()!;
        const regressed = options.previousPassCount !== undefined && currentPass < options.previousPassCount;
        return {
          passed: !regressed,
          testPassCount: currentPass,
          ...(regressed ? { testPassCountRegressed: true } : {}),
          steps: [{ name: 'test', ok: !regressed, skipped: false, summary: regressed ? `fail: previous-pass=${options.previousPassCount} current-pass=${currentPass}` : 'pass' }],
          // worktree 는 «3 fail» — base 5 보다 적으므로 종전 규칙이면 흡수돼 PASS 로 뒤집힌다.
          log: regressed ? '3 fail\n4 pass\nRan 7 tests across 1 file.' : '',
        };
      },
      prManager: { upsertPr: () => ({ noop: true }) } as unknown as PrManager,
    });
    const targets = [{ ...target, id: 'a', slug: 'a' }, { ...target, id: 'b', slug: 'a' }];
    const results = await runNocturnal(targets, true, deps);
    // ⛔ 두 번째가 gate-failed 로 «남아야» 한다. 흡수되면 pr-failed(=게이트 통과)로 뒤집힌다.
    expect(results[1]?.status).toBe('gate-failed');
    expect(results[1]?.evidence?.steps[0]?.summary).toContain('previous-pass=5 current-pass=4');
  });

  test('승인 큐 비었으면 no-approved', async () => {
    const r = await runNocturnal([], true, baseDeps());
    expect(r[0]!.status).toBe('no-approved');
  });
});
