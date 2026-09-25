import { describe, expect, it } from 'bun:test';
import { resolveSurfaceUx } from '../agent/surface-ux/build.js';
import { debug } from '../debug/log.js';
import type { FeedbackEnvelope } from '../feedback/envelope.js';
import { applyHarnessRunOutcomeExit, HARNESS_RUN_DEPRECATION_HELP, HARNESS_RUN_DEPRECATION_LOG_CATEGORY, HARNESS_RUN_DEPRECATION_NOTICE, HARNESS_RUN_REPLACEMENT, harnessProgressUxSource, runHarnessRunCliCommand, runHarnessRunPipeline, type ExitCodeHolder, type HarnessRunCliOpts, type HarnessRunCliOutcome } from './harness-run-cli.js';
import {
  buildHarnessRunDevSpec, buildSelfImplementPlanDevSpec, planDevPipeline, runDevPipeline,
  type DevDispatch, type DevHarnessDispatchArgs, type DevPipelineDeps, type DevPipelineSpec, type ResolvedDevPlan,
} from './dev-pipeline.js';

const output = { output: 'done' };

/** Non-observability tests must never write the default debug trail. */
const noOpDeprecatedInvocationDeps = {
  onDeprecatedInvocation: () => {},
  onDeprecationNotice: () => {},
};

async function dispatched(opts: HarnessRunCliOpts): Promise<DevHarnessDispatchArgs> {
  let args: DevHarnessDispatchArgs | undefined;
  const outcome = await runHarnessRunPipeline(['objective'], opts, {
    ...noOpDeprecatedInvocationDeps,
    pipelineDeps: { dispatchRunDevHarness: async (received) => { args = received; return output; } },
  });
  expect(outcome).toEqual({ ok: true, output: 'done', exitCode: 0 });
  return args!;
}

describe('harness run — deprecated entrance', () => {
  it('help exposes deprecation and the canonical replacement', () => {
    expect(HARNESS_RUN_REPLACEMENT).toBe('monad harness say <objective>');
    expect(HARNESS_RUN_DEPRECATION_HELP).toContain('DEPRECATED');
    expect(HARNESS_RUN_DEPRECATION_HELP).toContain(HARNESS_RUN_REPLACEMENT);
    expect(HARNESS_RUN_DEPRECATION_NOTICE).toContain(HARNESS_RUN_REPLACEMENT);
    expect(HARNESS_RUN_DEPRECATION_NOTICE).not.toContain('현재는 동일 동작');
  });

  it('actual harness-run caller emits the retired notice and observation then refuses the pipeline', async () => {
    const notices: string[] = [];
    const observations: Array<{ entrance: string; entranceStatus: string }> = [];
    let dispatches = 0;
    const outcome = await runHarnessRunCliCommand(['objective'], {}, {
      onDeprecationNotice: (notice) => notices.push(notice),
      logLaunchEntrance: (data) => observations.push(data),
      pipelineDeps: { dispatchRunDevHarness: async () => { dispatches += 1; return output; } },
    });

    expect(outcome).toEqual({ ok: false, message: HARNESS_RUN_DEPRECATION_NOTICE, exitCode: 1 });
    expect(notices).toEqual([
      '[ask] ⚠️ 이 발사 입구는 은퇴했다: cli-harness-run',
      HARNESS_RUN_DEPRECATION_NOTICE,
    ]);
    expect(observations).toEqual([{ entrance: 'cli-harness-run', entranceStatus: 'retired' }]);
    expect(dispatches).toBe(0);
  });

  it('records the default queryable debug event exactly once', async () => {
    const observed: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category, event, data) => {
      observed.push({ category: String(category), event: String(event), data: data as Record<string, unknown> });
    }) as typeof debug.log;
    try {
      const outcome = await runHarnessRunCliCommand(['objective'], {}, {
        onDeprecationNotice: () => {},
        pipelineDeps: { dispatchRunDevHarness: async () => output },
      });
      expect(outcome).toEqual({ ok: false, message: HARNESS_RUN_DEPRECATION_NOTICE, exitCode: 1 });
      expect(observed.filter(({ category }) => category === HARNESS_RUN_DEPRECATION_LOG_CATEGORY)).toEqual([{
        category: HARNESS_RUN_DEPRECATION_LOG_CATEGORY,
        event: 'harness-run-invoked',
        data: {
          replacement: HARNESS_RUN_REPLACEMENT,
          entrance: 'cli-harness-run',
          entranceStatus: 'retired',
        },
      }]);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
  });

  it('still refuses when deprecated warning or observation fails', async () => {
    let dispatches = 0;
    const outcome = await runHarnessRunCliCommand(['objective'], {}, {
      onDeprecationNotice: () => { throw new Error('stderr unavailable'); },
      onDeprecatedInvocation: () => { throw new Error('logs unavailable'); },
      pipelineDeps: { dispatchRunDevHarness: async () => { dispatches += 1; return output; } },
    });

    expect(outcome).toEqual({ ok: false, message: HARNESS_RUN_DEPRECATION_NOTICE, exitCode: 1 });
    expect(dispatches).toBe(0);
  });

  it('launch site: program.parseAsync of harness run emits the replacement and exits non-zero', async () => {
    const { program } = await import('../index.js');
    const originalLog = console.log;
    const originalError = console.error;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const originalDebugLog = debug.log;
    const previousExitCode = process.exitCode;
    const previousRunId = process.env.MONAD_RUN_ID;
    const output: string[] = [];
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
    console.error = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
    process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      output.push(String(chunk));
      if (typeof encoding === 'function') encoding();
      else cb?.();
      return true;
    }) as typeof process.stderr.write;
    (debug as { log: typeof debug.log }).log = (() => {}) as typeof debug.log;
    process.exitCode = undefined;
    try {
      await program.parseAsync(['node', 'monad', 'harness', 'run', 'objective']);
      expect(output.join('\n')).toContain('monad harness say <objective>');
      const exitCode = Number(process.exitCode);
      expect(exitCode).not.toBe(0);
      expect(exitCode).toBe(1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.stderr.write = originalStderrWrite;
      (debug as { log: typeof debug.log }).log = originalDebugLog;
      process.exitCode = previousExitCode ?? 0;
      if (previousRunId === undefined) delete process.env.MONAD_RUN_ID;
      else process.env.MONAD_RUN_ID = previousRunId;
    }
  });
});

describe('harness run — unified plan-staged reroute', () => {
  const cases: Array<[string, HarnessRunCliOpts, keyof DevHarnessDispatchArgs, unknown]> = [
    ['objective', {}, 'objective', 'objective'],
    ['target', { target: '/other-repo' }, 'target', '/other-repo'],
    ['autoDrive', { autoDrive: 'off' }, 'auto_drive', 'off'],
    ['autoReview', { autoReview: true }, 'auto_review', true],
    ['base', { base: 'next' }, 'base', 'next'],
    ['redTeam', { redTeam: true }, 'red_team', true],
    ['multiAngle', { multiAngle: true }, 'multi_angle', true],
    ['domain', { domain: 'skill' }, 'domain', 'skill'],
    ['carryCapsule', { carryCapsule: true }, 'carry_capsule', true],
    ['sizingMode', { sizingMode: 'off' }, 'sizing_mode', 'off'],
    ['ledgerMode', { ledgerMode: 'observe' }, 'ledger_mode', 'observe'],
  ];

  for (const [name, opts, executorField, value] of cases) {
    it(`${name} reaches dispatchRunDevHarness unchanged without payload pollution`, async () => {
      expect(await dispatched(opts)).toEqual({ objective: 'objective', [executorField]: value });
    });
  }

  it('omits target and auto_drive when neither CLI option is given', async () => {
    const args = await dispatched({});
    expect(args).toEqual({ objective: 'objective' });
    expect(args).not.toHaveProperty('target');
    expect(args).not.toHaveProperty('auto_drive');
  });

  it('preserves explicitly supplied target and auto_drive values without defaults', async () => {
    expect(await dispatched({ target: '/repo', autoDrive: 'on' }))
      .toEqual({ objective: 'objective', target: '/repo', auto_drive: 'on' });
  });

  it('carries explicit false boolean harness options to the seam', async () => {
    expect(await dispatched({ autoReview: false, redTeam: false, multiAngle: false, carryCapsule: false }))
      .toEqual({ objective: 'objective', auto_review: false, red_team: false, multi_angle: false, carry_capsule: false });
  });

  it('leaves the other nine harness options unchanged', async () => {
    expect(await dispatched({
      autoReview: true, base: 'release', redTeam: true, multiAngle: true, domain: 'research',
      carryCapsule: true, sizingMode: 'observe', ledgerMode: 'off',
    })).toEqual({
      objective: 'objective', auto_review: true, base: 'release', red_team: true, multi_angle: true,
      domain: 'research', carry_capsule: true, sizing_mode: 'observe', ledger_mode: 'off',
    });
  });

  it('uses injected runDevPipeline instead of calling the executor directly', async () => {
    let receivedSpec: DevPipelineSpec | undefined;
    const fakeRun = (async (spec: DevPipelineSpec) => {
      receivedSpec = spec;
      return { plan: {} as ResolvedDevPlan, kind: 'plan-staged' as const, result: output };
    }) as typeof runDevPipeline;
    const opts: HarnessRunCliOpts = { target: '/repo', autoDrive: 'on', redTeam: true };
    const outcome = await runHarnessRunPipeline(['objective'], opts, { ...noOpDeprecatedInvocationDeps, runDevPipeline: fakeRun });
    expect(outcome).toEqual({ ok: true, output: 'done', exitCode: 0 });
    expect(receivedSpec).toEqual(buildHarnessRunDevSpec({ objective: 'objective', ...opts }));
  });

  it('no objective preserves exit 1 and does not invoke the pipeline', async () => {
    let called = false;
    const fakeRun = (async () => { called = true; return {} as never; }) as typeof runDevPipeline;
    expect(await runHarnessRunCliCommand([], {}, { ...noOpDeprecatedInvocationDeps, runDevPipeline: fakeRun }))
      .toEqual({ ok: false, message: 'objective 필요', exitCode: 1 });
    expect(await runHarnessRunPipeline([], {}, { ...noOpDeprecatedInvocationDeps, runDevPipeline: fakeRun }))
      .toEqual({ ok: false, message: 'objective 필요', exitCode: 1 });
    expect(called).toBe(false);
  });

  it('harness options with another dispatch are rejected with the resolved dispatch name', () => {
    expect(() => planDevPipeline({ input: { text: 'x' }, context: 'interactive', harness: { target: '/repo' } }))
      .toThrow(/staged harness 실행 옵션은 plan-staged dispatch.*interactive/);
  });

  const dispatchCases: Array<[DevDispatch, DevPipelineSpec]> = [
    ['self-mission', { input: { text: 'x' } }],
    ['monad-tui', { input: { text: 'x' }, monad: { goal: 'g' } }],
    ['agent-mission-pty', { input: { text: 'x' }, executor: { kind: 'external', backend: 'codex' }, branch: 'b' }],
    ['acp', { input: { text: 'x' }, executor: { kind: 'external', backend: 'codex', transport: 'acp' } }],
    ['parallel', { input: { text: 'x' }, parallel: { goals: [{ feature: 'g' }] } }],
    ['interactive', { input: { text: 'x' }, context: 'interactive' }],
    ['plan-staged', { input: { text: 'x' }, plan: true }],
  ];
  for (const [dispatch, spec] of dispatchCases) {
    it(`preserves ${dispatch} dispatch selection`, () => {
      expect(planDevPipeline(spec).dispatch).toBe(dispatch);
    });
  }

  it('self implement --plan still calls the same dispatchRunDevHarness seam with existing arguments', async () => {
    let args: DevHarnessDispatchArgs | undefined;
    const deps: DevPipelineDeps = { dispatchRunDevHarness: async (received) => { args = received; return output; } };
    const result = await runDevPipeline(buildSelfImplementPlanDevSpec({ feature: 'F', base: 'main', openPr: true }), deps);
    expect(result.kind).toBe('plan-staged');
    expect(args).toEqual({ objective: 'F', target: 'self', auto_drive: 'on', base: 'main' });
  });

  it('success leaves process.exitCode untouched (original action behaviour)', () => {
    const okOutcome: HarnessRunCliOutcome = { ok: true, output: 'done', exitCode: 0 };
    const unset: ExitCodeHolder = {};
    applyHarnessRunOutcomeExit(okOutcome, unset);
    expect(unset.exitCode).toBeUndefined();
    // 사전 설정된(non-zero) exitCode 도 성공 경로가 덮어쓰지 않는다.
    const preset: ExitCodeHolder = { exitCode: 7 };
    applyHarnessRunOutcomeExit(okOutcome, preset);
    expect(preset.exitCode).toBe(7);
  });

  it('failure sets process.exitCode to the outcome code (original catch behaviour)', () => {
    const proc: ExitCodeHolder = {};
    applyHarnessRunOutcomeExit({ ok: false, message: 'boom', exitCode: 1 }, proc);
    expect(proc.exitCode).toBe(1);
  });

  it('keeps the existing four seam fields required while accepting all seven widened fields', async () => {
    const seam: NonNullable<DevPipelineDeps['dispatchRunDevHarness']> = async ({
      objective, target, auto_drive, base, auto_review, red_team, multi_angle, domain,
      carry_capsule, sizing_mode, ledger_mode,
    }) => {
      expect({ objective, target, auto_drive, base, auto_review, red_team, multi_angle, domain, carry_capsule, sizing_mode, ledger_mode })
        .toEqual({
          objective: 'F', target: 'self', auto_drive: 'safe', base: undefined,
          auto_review: undefined, red_team: undefined, multi_angle: undefined, domain: undefined,
          carry_capsule: undefined, sizing_mode: undefined, ledger_mode: undefined,
        });
      return output;
    };
    await runDevPipeline(buildSelfImplementPlanDevSpec({ feature: 'F' }), { dispatchRunDevHarness: seam });
  });
});

// ⭐ 진행 릴레이(2026-08-11 73차) — `harness run` 이 8분 3초를 «0줄»로 돌던 것을 잇는다.
//   ⛔ 반증 지점: 이 릴레이가 «없으면» 시퀀서가 progress 를 내도 부모는 아무것도 못 본다.
//   ⭐ 합성 엔벨로프를 쓰지 않고 «실제 생산자»(resolveSurfaceUx)를 통과시킨다 — 계약이 바뀌면 여기서 깨진다.
describe('harness run — 스테이지 진행이 부모로 간다', () => {
  it('SurfaceUx.progress 가 낸 줄이 onProgress 로 온다 (실제 엔벨로프 경로)', () => {
    const lines: string[] = [];
    const ux = resolveSurfaceUx({ sessionId: 's1', toolCallId: 't1', ...harnessProgressUxSource((line) => lines.push(line)) });
    ux.progress('[plan] 계획…', { phase: 'start' });
    ux.progress('[execute] 구현…', { phase: 'delta' });
    expect(lines).toEqual(['[plan] 계획…', '[execute] 구현…']);
  });

  it("종결 요약(phase:'end')은 «거른다» — CLI 가 최종 결과를 스스로 찍어 중복이 된다", () => {
    const lines: string[] = [];
    const ux = resolveSurfaceUx({ sessionId: 's2', toolCallId: 't2', ...harnessProgressUxSource((line) => lines.push(line)) });
    ux.progress('[plan] 계획…', { phase: 'start' });
    ux.progress('⚠️ 미완(execute-failed): <결과 전문>', { phase: 'end' });
    expect(lines).toEqual(['[plan] 계획…']);
  });

  it('진행이 아닌 엔벨로프는 흘리지 않는다', () => {
    const lines: string[] = [];
    const source = harnessProgressUxSource((line) => lines.push(line));
    // 합성 — SurfaceUx 는 progress 외 종류를 emitFeedback 으로 내보내지 않아 실경로로는 못 만든다.
    source.emitFeedback!({ kind: 'tool.diff' } as unknown as FeedbackEnvelope);
    expect(lines).toEqual([]);
  });

  it('onProgress 를 주어도 주입된 dispatch 가 이긴다 — 기존 무실행 주입 계약 보존', async () => {
    let seen: DevHarnessDispatchArgs | undefined;
    const outcome = await runHarnessRunPipeline(['objective'], {}, {
      ...noOpDeprecatedInvocationDeps,
      onProgress: () => { throw new Error('진행 릴레이가 주입 dispatch 를 밀어냈다'); },
      pipelineDeps: { dispatchRunDevHarness: async (received) => { seen = received; return output; } },
    });
    expect(outcome).toEqual({ ok: true, output: 'done', exitCode: 0 });
    expect(seen).toEqual({ objective: 'objective' });
  });

  it('onProgress 를 안 주면 종전과 «글자 그대로» 같다', async () => {
    const outcome = await runHarnessRunPipeline(['objective'], {}, {
      ...noOpDeprecatedInvocationDeps,
      pipelineDeps: { dispatchRunDevHarness: async () => output },
    });
    expect(outcome).toEqual({ ok: true, output: 'done', exitCode: 0 });
  });
});

describe('입구 통합 P2 — 은퇴 문면이 «선언에서» 온다', () => {
  it('⭐ --help 문면이 «레지스트리에서» 온다 — 손으로 짓지 않는다 (RFC P2)', async () => {
    const { CLI_HARNESS_RUN_ENTRANCE, describeEntranceCommand } = await import('./entrance-registry.js');
    // 🔑 「같은 문자열이 나온다」가 아니라 ***「같은 «자»가 만든다」***를 문다.
    //   ⛔ 손으로 지은 문면과 «우연히» 같을 수 있으므로, 레지스트리 함수를 직접 불러 대조한다.
    expect(HARNESS_RUN_DEPRECATION_HELP)
      .toBe(describeEntranceCommand(CLI_HARNESS_RUN_ENTRANCE, HARNESS_RUN_REPLACEMENT, '이 입구는 더 이상 실행되지 않습니다.').trimEnd());
    // ⛔ 입구 «이름»이 문면에 있다 — 어느 문인지 사람이 알아야 한다.
    expect(HARNESS_RUN_DEPRECATION_HELP).toContain(CLI_HARNESS_RUN_ENTRANCE.id);
    // ⛔ 「금지만 주고 길을 안 준」이 아니다 — 갈 곳이 있다.
    expect(HARNESS_RUN_DEPRECATION_HELP).toContain(HARNESS_RUN_REPLACEMENT);
  });

  it('⛔ 실행 «중» 문면과 --help 문면은 «다른 것»이다 — 되풀이하지 않는다', () => {
    // 종전엔 HELP 가 NOTICE 를 통째로 감싸 같은 말이 두 번 나왔다.
    expect(HARNESS_RUN_DEPRECATION_HELP).not.toContain(HARNESS_RUN_DEPRECATION_NOTICE);
  });
});
