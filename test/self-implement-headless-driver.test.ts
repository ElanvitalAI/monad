// P1 · 헤드리스 monad 드라이버 완료-감지 로직 테스트 (2026-07-19).
// startPty 를 fake 로 주입 — 실 PTY/프로세스 무접촉.

import { describe, it, expect, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import Database from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { debug } from '../src/debug/log.js';
import { driveHeadlessMonad, normalizeDeterministicCompletionState, runHeadlessGoalLoopPty } from '../src/self-implement/headless-monad-driver.js';
import { monadTuiSpawnOptions } from '../src/self-implement/monad-tui-spawn.js';
import { runPtyDrive } from '../src/cli/pty-drive-cli.js';
import { setPtyAdapterForTesting } from '../src/pty-shell/registry.js';
import { getChannelBus } from '../src/terminal-matrix/index.js';
import { ChannelBus } from '../src/terminal-matrix/channel-bus.js';
import { subscribeSurfaceFrames, type SelfReportFrame } from '../src/capture/self-report-frame.js';
import { attachLifecycleBridge, readRunLifecycleFromStateDir, resetLifecycleBridgeForTesting } from '../src/signal/lifecycle-bridge.js';
import { publishLifecycleRecord, type LifecycleRecord } from '../src/signal/lifecycle-record.js';
import { readLifecycleRootReport } from '../src/signal/lifecycle-root-report.js';

function fakeHandle(screen: string, snap: string, id = 't') {
  return {
    id, cmd: 'bun', workdir: '/w', startedAt: 0, lastActivityAt: 0, detach: false,
    exitCode: null, exitSignal: undefined,
    isAlive: () => true, canWrite: () => true, appendOutput: () => {}, drainDelta: () => '', snapshot: () => snap,
    write: () => {}, kill: () => {}, resize: () => {},
    renderScreen: async () => screen, renderScreenPng: async () => null,
  } as never;
}

// ★ G9 P3b — executor 화면이 exec:<ptyId> surfaceId 로 프레임 버스에 실제 발행되는 wiring 검증(Goodhart 방지:
//   publishSelfReportFrame 배선을 지우면 이 테스트가 실패). fake spawn + 실 ChannelBus 구독.
describe('runHeadlessGoalLoopPty — G9 P3b executor 프레임 발행 wiring', () => {
  it('executor 화면을 exec:<ptyId> surfaceId·kind=headless 로 버스 발행', async () => {
    const ptyId = 'exec-wire-test-pty';
    const seen: SelfReportFrame[] = [];
    const sub = subscribeSurfaceFrames(getChannelBus(), `exec:${ptyId}`, (f) => { seen.push(f); });
    const prev = process.env.MONAD_RUN_ID;
    process.env.MONAD_RUN_ID = 'run-p3b-anchor'; // K4 — space.runId 가 이 값을 실어 프레임에 스탬프돼야
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 2,
        ptyAvailable: () => true,
        // snapshot='GOAL-COMPLETE' → 첫 tick 렌더+발행 후 완료 break. render throttle(lastFrameRenderMs=0)이 즉시 발행.
        spawn: (() => fakeHandle('executor live screen', 'GOAL-COMPLETE', ptyId)) as never,
      });
    } finally {
      sub.unsubscribe();
      if (prev === undefined) delete process.env.MONAD_RUN_ID; else process.env.MONAD_RUN_ID = prev;
    }
    expect(seen.length).toBeGreaterThan(0);            // 발행됐다(배선 삭제 시 0 → 실패)
    expect(seen[0]!.surfaceId).toBe(`exec:${ptyId}`);  // execSurfaceId 소비(P3a·Q1)
    expect(seen[0]!.kind).toBe('headless');
    expect(seen[0]!.text).toContain('executor live screen');
    expect(seen[0]!.runId).toBe('run-p3b-anchor');     // K4 runId 스탬프(실 경로)
    expect(typeof seen[0]!.instance).toBe('string');   // instance 스탬프(resolveInstanceName)
    expect(seen[0]!.instance.length).toBeGreaterThan(0);
  });
});

describe('monadTuiSpawnOptions — bare TUI spawn recipe', () => {
  it('is the sole recipe shared by legacy and drive callers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shared-tui-recipe-'));
    const configDir = realpathSync(root);
    const stateDir = configDir;
    const recipe = monadTuiSpawnOptions({
      repoRoot: '/r', cwd: root, configDir, stateDir, cols: 120, rows: 30,
      space: { inHarness: true, kind: 'self-implement', id: 'shared-recipe', runId: '' },
    });
    let driveSpawned: { cmd?: string; args?: string[]; env?: Record<string, string>; workdir?: string; accessMode?: string; transitionPolicy?: string; cols?: number; rows?: number } | undefined;
    setPtyAdapterForTesting((opts) => {
      driveSpawned = opts;
      return {
        pid: 1, write: () => {}, kill: () => {}, resize: () => {},
        onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
      };
    });
    try {
      await runPtyDrive({
        monad: true, goal: 'x', repoRoot: '/r', cwd: root, isolatedRoot: root, cols: 120, rows: 30, bootMs: 0, sleep: async () => {},
        stream: async () => '{"action":"done","reason":"ready"}', out: () => {}, maxSteps: 1, pollMs: 0,
      });
    } finally {
      setPtyAdapterForTesting(null);
    }
    let legacySpawned: { cmd?: string; args?: string[]; env?: Record<string, string>; workdir?: string; accessMode?: string; transitionPolicy?: string; cols?: number; rows?: number } | undefined;
    await driveHeadlessMonad({
      repoRoot: '/r', cwd: root, prompt: 'x', configDir, stateDir, cols: 120, rows: 30, bootSec: 0, maxWaitSec: 1,
      spawn: ((opts: typeof recipe) => { legacySpawned = opts; return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE'); }) as never,
      ptyAvailable: () => true,
    });
    expect(recipe).toMatchObject({
      cmd: 'bun', args: ['/r/bin/monad.mjs', '--config-dir', configDir, '--test-state-dir', stateDir],
      env: { MONAD_STATE_DIR: stateDir }, accessMode: 'auto', transitionPolicy: 'open', cols: 120, rows: 30,
    });
    // These are the complete bare-TUI recipe values both callers must preserve.
    // A caller changing even one recipe value fails here; caller-specific environment additions remain outside this recipe.
    const bareRecipe = {
      cmd: recipe.cmd,
      args: recipe.args,
      workdir: recipe.workdir,
      env: { MONAD_STATE_DIR: stateDir },
      accessMode: recipe.accessMode,
      transitionPolicy: recipe.transitionPolicy,
      cols: recipe.cols,
      rows: recipe.rows,
    };
    for (const spawned of [driveSpawned, legacySpawned]) {
      expect({
        cmd: spawned?.cmd,
        args: spawned?.args,
        workdir: spawned?.workdir,
        env: { MONAD_STATE_DIR: spawned?.env?.MONAD_STATE_DIR },
        accessMode: spawned?.accessMode,
        transitionPolicy: spawned?.transitionPolicy,
        cols: spawned?.cols,
        rows: spawned?.rows,
      }).toEqual(bareRecipe);
    }
  });
});

describe('headless.spawn handed-directory observation', () => {
  async function observeBothAxes(configDir?: string, stateDir?: string, runId?: string) {
    const observations: Record<string, unknown>[] = [];
    const spawnArgs: Array<string[] | undefined> = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.spawn') observations.push(data ?? {});
    }) as never);
    try {
      await driveHeadlessMonad({
        repoRoot: '/repo', cwd: '/worktree', prompt: 'x', configDir, stateDir, runId, bootSec: 0, maxWaitSec: 1,
        ptyAvailable: () => true,
        spawn: ((options: { args?: string[] }) => {
          spawnArgs.push(options.args);
          return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE', 'legacy-pty');
        }) as never,
      });
      await runHeadlessGoalLoopPty({
        binRoot: '/repo', cwd: '/worktree', featurePrompt: 'x', configDir, stateDir, runId, pollMs: 1, maxWaitSec: 1,
        ptyAvailable: () => true,
        spawn: ((options: { args?: string[] }) => {
          spawnArgs.push(options.args);
          return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE', 'executor-pty');
        }) as never,
      });
    } finally {
      log.mockRestore();
    }
    return { legacy: observations[0]!, executor: observations[1]!, spawnArgs };
  }

  it('uses handed-directory names at both sites and preserves their spawn argv', async () => {
    const { legacy, executor, spawnArgs } = await observeBothAxes('/isolated-config', '');
    expect(legacy).toMatchObject({
      cwd: '/worktree', repoRoot: '/repo', configDirPassed: true, stateDirPassed: false,
    });
    expect(executor).toMatchObject({
      ptyId: 'executor-pty', cwd: '/worktree', configDirPassed: true, stateDirPassed: false, transport: 'pty',
    });
    expect(legacy.screenKey).toBe(executor.screenKey);
    // Both callers must retain these recipe-derived observations; deleting one is a real caller divergence.
    for (const observation of [legacy, executor]) {
      expect(observation).toMatchObject({
        cwd: '/worktree', configDirPassed: true, stateDirPassed: false, runId: expect.any(String), screenKey: expect.any(String),
      });
    }
    expect(legacy).toMatchObject({ repoRoot: '/repo' });
    expect(executor).toMatchObject({ ptyId: 'executor-pty', transport: 'pty' });
    // executor-only: childLlm is consumed by childLlmSelectionEnv and goal-run history, not the legacy bare TUI.
    expect(executor.childLlm).toBeNull();
    // executor-only: escalateTier drives executor rework-policy environment selection, which legacy never enters.
    expect(executor.escalateTier).toBe('none');
    // executor-only: grokCredentialFreshness is a Grok preflight snapshot for an explicit executor child brain.
    expect(executor.grokCredentialFreshness).toBeNull();
    // executor-only: surfaceLinkUnavailableReason describes the executor PTY's PWA surface-link resolution.
    expect(executor.surfaceLinkUnavailableReason).toBeDefined();
    for (const observation of [legacy, executor]) {
      expect(observation.configIsolated).toBeUndefined();
      expect(observation.stateIsolated).toBeUndefined();
      expect(observation.isolated).toBeUndefined();
    }
    expect(spawnArgs).toEqual([
      ['/repo/bin/monad.mjs'],
      ['/repo/bin/monad.mjs', 'dev', '--implement', '--config-dir', '/isolated-config', 'x'],
    ]);
  });

  it('joins both spawn observations to the caller-owned runId', async () => {
    const { legacy, executor } = await observeBothAxes('/isolated-config', '/isolated-state', 'run-spawn-join');
    expect(legacy.runId).toBe('run-spawn-join');
    expect(executor.runId).toBe('run-spawn-join');
  });

  it('keeps each handed-directory axis independent of the other input', async () => {
    const configOnly = await observeBothAxes('/config-a', '');
    const stateChanged = await observeBothAxes('/config-a', '/state-b');
    const configChanged = await observeBothAxes('', '/state-b');
    for (const observation of [configOnly.legacy, configOnly.executor]) {
      expect(observation).toMatchObject({ configDirPassed: true, stateDirPassed: false });
    }
    for (const observation of [stateChanged.legacy, stateChanged.executor]) {
      expect(observation).toMatchObject({ configDirPassed: true, stateDirPassed: true });
    }
    for (const observation of [configChanged.legacy, configChanged.executor]) {
      expect(observation).toMatchObject({ configDirPassed: false, stateDirPassed: true });
    }
  });

  it('leaves omitted inputs unknown instead of asserting that the child is un-isolated', async () => {
    const { legacy, executor } = await observeBothAxes();
    for (const observation of [legacy, executor]) {
      expect(observation).toMatchObject({ configDirPassed: 'unknown', stateDirPassed: 'unknown' });
      expect(Object.values(observation)).not.toContain(false);
    }
  });

  it('keeps cannot-tell distinct from an explicitly not-passed directory', async () => {
    const unknown = await observeBothAxes();
    const notPassed = await observeBothAxes('', '');
    for (const observation of [unknown.legacy, unknown.executor]) {
      expect(observation).toMatchObject({ configDirPassed: 'unknown', stateDirPassed: 'unknown' });
    }
    for (const observation of [notPassed.legacy, notPassed.executor]) {
      expect(observation).toMatchObject({ configDirPassed: false, stateDirPassed: false });
    }
  });
});

describe('driveHeadlessMonad — 완료 감지', () => {
  it('GOAL-COMPLETE 마커 감지 → reachedCompletion + 툴콜 카운트', async () => {
    const r = await driveHeadlessMonad({
      repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 3,
      spawn: (() => fakeHandle('작업 중...\nGOAL-COMPLETE', '⏺ Read(a)\n⏺ Edit(b)\nGOAL-COMPLETE')) as never,
      ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(true);
    expect(r.toolCalls).toBe(2);
    expect(r.transcript).toContain('GOAL-COMPLETE');
  });

  it('⭐ 2000자를 넘는 자식 보고문은 앞부분 결손을 표시한다', async () => {
    const r = await driveHeadlessMonad({
      repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 1,
      spawn: (() => fakeHandle('GOAL-COMPLETE', `CHILD-FIRST-${'x'.repeat(2500)}-CHILD-LAST\nGOAL-COMPLETE`)) as never,
      ptyAvailable: () => true,
    });
    expect(r.summary).toContain('[상한 2000자 — 앞부분');
    expect(r.summary).toContain('CHILD-LAST');
    expect(r.summary).not.toContain('CHILD-FIRST');
  });

  it('legacy terminal verdict records its resolved runId without changing prior fields', async () => {
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.done') observations.push(data ?? {});
    }) as never);
    try {
      await driveHeadlessMonad({
        repoRoot: '/r', cwd: '/w', prompt: 'x', runId: 'run-legacy-terminal', bootSec: 0, maxWaitSec: 1,
        spawn: (() => fakeHandle('GOAL-COMPLETE', '⏺ Read(a)\nGOAL-COMPLETE')) as never,
        ptyAvailable: () => true,
      });
    } finally {
      log.mockRestore();
    }
    expect(observations).toEqual([{
      runId: 'run-legacy-terminal', reachedCompletion: true, exitReason: 'completion-marker', toolCalls: 1,
      chars: '⏺ Read(a)\nGOAL-COMPLETE'.length,
    }]);
  });

  it('legacy 종료 양상마다 headless.done에 runId와 구분된 사유를 기록한다', async () => {
    const captureDone = async (screen: string, snap: string, opts: { maxWaitSec?: number; ptyAvailable?: () => boolean } = {}) => {
      const observations: Record<string, unknown>[] = [];
      const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
        if (event === 'headless.done') observations.push(data ?? {});
      }) as never);
      try {
        await driveHeadlessMonad({
          repoRoot: '/r', cwd: '/w', prompt: 'x', runId: 'run-legacy-reasons', bootSec: 0,
          maxWaitSec: opts.maxWaitSec ?? 1, ptyAvailable: opts.ptyAvailable ?? (() => true),
          spawn: (() => fakeHandle(screen, snap)) as never,
        });
      } finally {
        log.mockRestore();
      }
      expect(observations.length).toBeGreaterThan(0);
      return observations.at(-1)!;
    };

    expect(await captureDone('GOAL-COMPLETE', 'GOAL-COMPLETE')).toMatchObject({ runId: 'run-legacy-reasons', exitReason: 'completion-marker' });
    expect(await captureDone('stable', 'stable', { maxWaitSec: 6 })).toMatchObject({ runId: 'run-legacy-reasons', exitReason: 'stable-screen' });
    expect(await captureDone('changing', 'unfinished', { maxWaitSec: 0 })).toMatchObject({ runId: 'run-legacy-reasons', exitReason: 'max-wait-exhausted' });
    expect(await captureDone('changing', 'GOAL-COMPLETE', { maxWaitSec: 0 })).toMatchObject({
      runId: 'run-legacy-reasons', reachedCompletion: true, exitReason: 'max-wait-exhausted',
    });
    expect(await captureDone('', '', { ptyAvailable: () => false })).toMatchObject({ runId: 'run-legacy-reasons', exitReason: 'pty-unavailable' });
  }, 10_000);

  it('legacy spawn/render/snapshot errors each emit one reasoned terminal event before propagating', async () => {
    const cases = [
      {
        name: 'spawn', expected: 'spawn-error',
        spawn: (() => { throw new Error('legacy spawn exploded'); }) as never,
      },
      {
        name: 'render', expected: 'render-error',
        spawn: (() => {
          const handle = fakeHandle('', '') as unknown as { renderScreen: () => Promise<string> };
          handle.renderScreen = async () => { throw new Error('legacy render exploded'); };
          return handle;
        }) as never,
      },
      {
        name: 'snapshot', expected: 'snapshot-error',
        spawn: (() => {
          const handle = fakeHandle('GOAL-COMPLETE', '') as unknown as { snapshot: () => string };
          handle.snapshot = () => { throw new Error('legacy snapshot exploded'); };
          return handle;
        }) as never,
      },
    ] as const;

    for (const testCase of cases) {
      const observations: Record<string, unknown>[] = [];
      const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
        if (event === 'headless.done') observations.push(data ?? {});
      }) as never);
      try {
        await expect(driveHeadlessMonad({
          repoRoot: '/r', cwd: '/w', prompt: 'x', runId: `run-legacy-${testCase.name}-error`,
          bootSec: 0, maxWaitSec: 1, spawn: testCase.spawn, ptyAvailable: () => true,
        })).rejects.toThrow(`legacy ${testCase.name} exploded`);
      } finally {
        log.mockRestore();
      }
      expect(observations).toEqual([expect.objectContaining({
        runId: `run-legacy-${testCase.name}-error`, exitReason: testCase.expected,
        error: `legacy ${testCase.name} exploded`,
      })]);
    }
  });

  it('legacy PTY probe 예외도 resolved runId와 고유 사유를 한 번 기록하고 전파한다', async () => {
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.done') observations.push(data ?? {});
    }) as never);
    try {
      await expect(driveHeadlessMonad({
        repoRoot: '/r', cwd: '/w', prompt: 'x', runId: 'run-legacy-probe-error',
        ptyAvailable: () => { throw new Error('legacy probe exploded'); },
        spawn: (() => { throw new Error('spawn must not run'); }) as never,
      })).rejects.toThrow('legacy probe exploded');
    } finally {
      log.mockRestore();
    }
    expect(observations).toEqual([expect.objectContaining({
      runId: 'run-legacy-probe-error', exitReason: 'pty-probe-error', error: 'legacy probe exploded',
    })]);
  });

  it('legacy spawn 후 초기화 로그 예외도 terminal event를 한 번 남기고 PTY를 정리한다', async () => {
    const observations: Record<string, unknown>[] = [];
    let kills = 0;
    const handle = fakeHandle('', '', 'legacy-init-pty') as unknown as { kill: () => void };
    handle.kill = () => { kills += 1; };
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (_category === 'run-identity' && event === 'propagate' && data?.via === 'headless-goal-loop') throw new Error('legacy initialization exploded');
      if (event === 'headless.done') observations.push(data ?? {});
    }) as never);
    try {
      await expect(driveHeadlessMonad({
        repoRoot: '/r', cwd: '/w', prompt: 'x', runId: 'run-legacy-init-error',
        spawn: (() => handle) as never, ptyAvailable: () => true,
      })).rejects.toThrow('legacy initialization exploded');
    } finally {
      log.mockRestore();
    }
    expect(kills).toBe(1);
    expect(observations).toEqual([expect.objectContaining({
      ptyId: 'legacy-init-pty', runId: 'run-legacy-init-error',
      exitReason: 'initialization-error', error: 'legacy initialization exploded',
    })]);
  });

  it('PTY 미가용 → reachedCompletion false', async () => {
    const r = await driveHeadlessMonad({
      repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0,
      spawn: (() => fakeHandle('', '')) as never,
      ptyAvailable: () => false,
    });
    expect(r.reachedCompletion).toBe(false);
    expect(r.summary).toContain('PTY unavailable');
  });

  it('마커 없이 안정화 → 완료 미도달(transcript 는 캡처)', async () => {
    const r = await driveHeadlessMonad({
      repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 3,
      spawn: (() => fakeHandle('안정된 화면(변화 없음)', '⏺ Grep(x)\n안정')) as never,
      ptyAvailable: () => true,
    });
    expect(r.reachedCompletion).toBe(false);
    expect(r.toolCalls).toBe(1);
  });

  // ★ K run-identity(MF4·2026-07-25) — REPLACE-env 지점의 runId 전파 계약 통합검증. headless-driver 는
  //   `...process.env` 를 상속 안 하고 env 를 REPLACE 하므로, coordinator 가 심은 MONAD_RUN_ID 가 자식 goal-loop
  //   PTY 로 도달하려면 harnessSpaceEnv 명시 stamp 가 있어야 한다(누락 시 K3 pty_manifest join 깨짐). 실 spawn env 캡처.
  it('runId 전파 계약 — process.env.MONAD_RUN_ID 가 자식 spawn env 로 전달(REPLACE env)', async () => {
    const prev = process.env.MONAD_RUN_ID;
    process.env.MONAD_RUN_ID = 'run-test-anchor-123';
    let capturedEnv: Record<string, string> | undefined;
    try {
      await driveHeadlessMonad({
        repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 1,
        spawn: ((o: { env?: Record<string, string> }) => { capturedEnv = o.env; return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE'); }) as never,
        ptyAvailable: () => true,
      });
    } finally {
      if (prev === undefined) delete process.env.MONAD_RUN_ID; else process.env.MONAD_RUN_ID = prev;
    }
    // 자식 env(REPLACE)에 anchor 도달 — 없으면 propagation 계약 깨진 것.
    expect(capturedEnv?.MONAD_RUN_ID).toBe('run-test-anchor-123');
  });

  // ⭐ 리뷰 should-fix — accessMode 는 **두 spawn 경로 모두**의 권한 계약이다. runHeadlessGoalLoopPty 만
  //   덮으면 이 경로가 조용히 'write'(사람 소유)로 남아 agent write 가 거부된다(P0-② 근본).
  it('★ accessMode=auto 로 스폰한다(agent write 허용 · 사람은 takeover 로 회수 — P0-② 수리)', async () => {
    let capturedMode: string | undefined;
    await driveHeadlessMonad({
      repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 1,
      spawn: ((o: { accessMode?: string }) => { capturedMode = o.accessMode; return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE'); }) as never,
      ptyAvailable: () => true,
    });
    expect(capturedMode).toBe('auto');
  });

  it('runId 도 항상 비어 있지 않다(상속 없을 때 canonical mint)', async () => {
    const prev = process.env.MONAD_RUN_ID;
    delete process.env.MONAD_RUN_ID;
    let capturedEnv: Record<string, string> | undefined;
    try {
      await driveHeadlessMonad({
        repoRoot: '/r', cwd: '/w', prompt: 'x', bootSec: 0, maxWaitSec: 1,
        spawn: ((o: { env?: Record<string, string> }) => { capturedEnv = o.env; return fakeHandle('GOAL-COMPLETE', 'GOAL-COMPLETE'); }) as never,
        ptyAvailable: () => true,
      });
    } finally {
      if (prev !== undefined) process.env.MONAD_RUN_ID = prev;
    }
    expect(capturedEnv?.MONAD_RUN_ID).toMatch(/^run-[A-Za-z0-9-]+$/);
  });
});


describe('runHeadlessGoalLoopPty — lifecycle scoreboard child-universe reads', () => {
  async function observeScoreboard(options: Partial<Parameters<typeof runHeadlessGoalLoopPty>[0]> = {}) {
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.lifecycle-screen-scoreboard') observations.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/worktree', featurePrompt: 'x', pollMs: 1, maxWaitSec: 1, runId: 'run-scoreboard',
        ptyAvailable: () => true,
        readPublisherStateDir: () => process.cwd(),
        spawn: (() => fakeHandle('done', 'GOAL-COMPLETE', 'scoreboard-pty')) as never,
        ...options,
      });
      return { result, observation: observations.at(-1)! };
    } finally {
      log.mockRestore();
    }
  }

  it('reads records from the state root reported by the child even when cwd derives elsewhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scoreboard-derived-'));
    const derived = join(root, 'derived-state');
    const manifest = join(derived, 'pty', 'manifest.db');
    mkdirSync(join(derived, 'pty'), { recursive: true });
    const db = new Database(manifest);
    try {
      db.run(`CREATE TABLE lifecycle_records (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, pty_id TEXT NOT NULL, subject_pty_id TEXT NOT NULL, seq INTEGER NOT NULL, depth INTEGER NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL, class TEXT NOT NULL, name TEXT NOT NULL, transition TEXT, resumable INTEGER, payload_json TEXT, truncated INTEGER NOT NULL, truncated_fields_json TEXT, created_at INTEGER NOT NULL)`);
      db.run(`INSERT INTO lifecycle_records VALUES (1, 'run-scoreboard', 'scoreboard-pty', 'scoreboard-pty', 1, 1, 'child', 1, 'progress', 'complete', NULL, NULL, '{"summary":"done","changedFiles":[]}', 0, NULL, 1)`);
    } finally { db.close(); }
    try {
      const { observation } = await observeScoreboard({
        cwd: root,
        readPublisherStateDir: () => derived,
        spawn: ((options: { id: string }) => {
          const childDb = new Database(manifest);
          try { childDb.run('UPDATE lifecycle_records SET subject_pty_id=?, pty_id=?', [options.id, options.id]); }
          finally { childDb.close(); }
          return fakeHandle('done', 'GOAL-COMPLETE', 'registry-id-differs') as never;
        }) as never,
      });
      expect(observation).toMatchObject({ classification: 'agree', signal: { recordCount: 1 }, lifecycleRead: { source: 'publisher-reported', emptyReason: null } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('uses the reported state directory rather than an unrelated supplied state directory', async () => {
    const explicit = mkdtempSync(join(tmpdir(), 'scoreboard-explicit-'));
    const derived = mkdtempSync(join(tmpdir(), 'scoreboard-derived-'));
    try {
      const reads: string[] = [];
      const { observation } = await observeScoreboard({
        stateDir: explicit,
        readPublisherStateDir: () => derived,
        readLifecycle: (stateDir) => {
          if (stateDir) reads.push(stateDir);
          return stateDir === explicit ? [] : [{ id: 1, record: { class: 'progress', name: 'complete' } as never }];
        },
      });
      expect(reads).toEqual([derived]);
      expect(observation).toMatchObject({ classification: 'agree', signal: { recordCount: 1, scopeStatus: 'scoped' }, lifecycleRead: { source: 'publisher-reported', emptyReason: null } });
    } finally {
      rmSync(explicit, { recursive: true, force: true });
      rmSync(derived, { recursive: true, force: true });
    }
  });

  it('does not infer a state root when the child did not report one', async () => {
    const { observation } = await observeScoreboard({
      stateDir: process.cwd(),
      readPublisherStateDir: () => undefined,
      readLifecycle: () => { throw new Error('must not read without a report'); },
    });
    expect(observation).toMatchObject({
      classification: 'screen-only',
      signal: { scopeStatus: 'unavailable' },
      lifecycleRead: { source: 'unresolved', emptyReason: 'publisher-root-unreported' },
    });
  });

  it('reports a missing reported directory without reading it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scoreboard-reported-absent-'));
    const absent = join(root, 'missing-state');
    let reads = 0;
    try {
      const { observation } = await observeScoreboard({
        readPublisherStateDir: () => absent,
        readLifecycle: () => { reads += 1; return []; },
      });
      expect(reads).toBe(0);
      expect(observation).toMatchObject({ signal: { scopeStatus: 'unavailable' }, lifecycleRead: { source: 'publisher-reported', emptyReason: 'directory-absent' } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('retains no-records only after opening the reported root', async () => {
    const reported = mkdtempSync(join(tmpdir(), 'scoreboard-reported-present-'));
    let reads = 0;
    try {
      const { observation } = await observeScoreboard({
        readPublisherStateDir: () => reported,
        readLifecycle: () => { reads += 1; return []; },
      });
      expect(reads).toBe(1);
      // An opened root with no child records stays empty; a parent terminal must not fabricate agreement.
      expect(observation).toMatchObject({ classification: 'screen-only', signal: { recordCount: 0, scopeStatus: 'no-records' }, lifecycleRead: { source: 'publisher-reported', emptyReason: 'no-records' } });
    } finally { rmSync(reported, { recursive: true, force: true }); }
  });

});

describe('runHeadlessGoalLoopPty — child lifecycle report wiring', () => {
  it('reads lifecycle records from the root reported through the actual spawn environment when handle id differs', async () => {
    const parentState = mkdtempSync(join(tmpdir(), 'lifecycle-parent-state-'));
    const childState = mkdtempSync(join(tmpdir(), 'lifecycle-child-state-'));
    const priorState = process.env.MONAD_STATE_DIR;
    const priorPtyId = process.env.MONAD_PTY_ID;
    const priorReport = process.env.MONAD_LIFECYCLE_ROOT_REPORT;
    const priorNonce = process.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE;
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.lifecycle-screen-scoreboard') observations.push(data ?? {});
    }) as never);
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/unrelated-worktree', featurePrompt: 'x', runId: 'run-wired', pollMs: 1, maxWaitSec: 1,
        ptyAvailable: () => true,
        spawn: ((options: { id: string; env: Record<string, string> }) => {
          const childEnv = options.env;
          process.env.MONAD_STATE_DIR = childState;
          process.env.MONAD_PTY_ID = childEnv.MONAD_PTY_ID;
          process.env.MONAD_LIFECYCLE_ROOT_REPORT = childEnv.MONAD_LIFECYCLE_ROOT_REPORT;
          process.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE = childEnv.MONAD_LIFECYCLE_ROOT_REPORT_NONCE;
          const bus = new ChannelBus();
          const detach = attachLifecycleBridge(bus, 'run-wired');
          const record: LifecycleRecord = {
            runId: 'run-wired', ptyId: options.id, subjectPtyId: options.id, seq: 1, depth: 1, role: 'child', at: Date.now(),
            class: 'progress', name: 'complete', payload: { summary: 'done', changedFiles: [] }, truncated: false,
          };
          publishLifecycleRecord(bus, record);
          detach();
          resetLifecycleBridgeForTesting();
          process.env.MONAD_STATE_DIR = parentState;
          return fakeHandle('done', 'GOAL-COMPLETE', 'registry-id-differs') as never;
        }) as never,
      });

      expect(observations.at(-1)).toMatchObject({
        classification: 'agree',
        signal: { recordCount: 1, subjectPtyId: expect.stringMatching(/^self_/), scopeStatus: 'scoped' },
        lifecycleRead: { source: 'publisher-reported', emptyReason: null },
      });
      expect(readRunLifecycleFromStateDir(childState, 'run-wired')).toHaveLength(1);
      expect(readRunLifecycleFromStateDir(parentState, 'run-wired')).toEqual([]);
    } finally {
      log.mockRestore();
      resetLifecycleBridgeForTesting();
      if (priorState === undefined) delete process.env.MONAD_STATE_DIR; else process.env.MONAD_STATE_DIR = priorState;
      if (priorPtyId === undefined) delete process.env.MONAD_PTY_ID; else process.env.MONAD_PTY_ID = priorPtyId;
      if (priorReport === undefined) delete process.env.MONAD_LIFECYCLE_ROOT_REPORT; else process.env.MONAD_LIFECYCLE_ROOT_REPORT = priorReport;
      if (priorNonce === undefined) delete process.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE; else process.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE = priorNonce;
      rmSync(parentState, { recursive: true, force: true });
      rmSync(childState, { recursive: true, force: true });
    }
  });

  it('does not accept an unreported current execution when an old report path exists', async () => {
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.lifecycle-screen-scoreboard') observations.push(data ?? {});
    }) as never);
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/unrelated-worktree', featurePrompt: 'x', runId: 'run-unreported', pollMs: 1, maxWaitSec: 1,
        ptyAvailable: () => true,
        spawn: ((options: { env: Record<string, string> }) => {
          expect(options.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE).toBeTruthy();
          return fakeHandle('done', 'GOAL-COMPLETE', 'different-registry-id') as never;
        }) as never,
      });
      expect(observations.at(-1)).toMatchObject({
        classification: 'screen-only',
        lifecycleRead: { source: 'unresolved', emptyReason: 'publisher-root-unreported' },
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe('runHeadlessGoalLoopPty — lifecycle report cleanup', () => {
  type CleanupSpawnOptions = { id: string; env: Record<string, string> };

  async function runWithReport(
    createReport: (reportPath: string, options: CleanupSpawnOptions) => void,
    readPublisherStateDir?: (reportPath: string, executionId: string, nonce: string) => string | undefined,
  ) {
    let reportPath = '';
    await runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-cleanup', pollMs: 1, maxWaitSec: 1,
      ptyAvailable: () => true,
      readPublisherStateDir,
      spawn: ((options: CleanupSpawnOptions) => {
        reportPath = options.env.MONAD_LIFECYCLE_ROOT_REPORT;
        mkdirSync(dirname(reportPath), { recursive: true });
        createReport(reportPath, options);
        return fakeHandle('done', 'GOAL-COMPLETE', 'cleanup-handle');
      }) as never,
    });
    return reportPath;
  }

  it('removes a successfully read lifecycle report and its interrupted-write remnant', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'lifecycle-cleanup-state-'));
    let acceptedStateDir: string | undefined;
    try {
      const reportPath = await runWithReport(
        (path, options) => {
          writeFileSync(path, JSON.stringify({
            executionId: options.id,
            nonce: options.env.MONAD_LIFECYCLE_ROOT_REPORT_NONCE,
            stateDir,
          }));
          writeFileSync(`${path}.interrupted.tmp`, 'partial');
        },
        (path, executionId, nonce) => {
          acceptedStateDir = readLifecycleRootReport(path, executionId, nonce);
          return acceptedStateDir;
        },
      );
      expect(acceptedStateDir).toBe(stateDir);
      expect(existsSync(reportPath)).toBe(false);
      expect(existsSync(`${reportPath}.interrupted.tmp`)).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('removes a lifecycle report rejected for execution identity mismatch', async () => {
    const reportPath = await runWithReport((path) => {
      writeFileSync(path, JSON.stringify({ executionId: 'wrong', nonce: 'wrong', stateDir: process.cwd() }));
    });
    expect(existsSync(reportPath)).toBe(false);
  });

  it('removes an unreadable lifecycle report after parsing fails', async () => {
    const reportPath = await runWithReport((path) => writeFileSync(path, '{not-json'));
    expect(existsSync(reportPath)).toBe(false);
  });

  it('removes a report when spawning fails before the child handle is available', async () => {
    let reportPath = '';
    await expect(runHeadlessGoalLoopPty({
      binRoot: '/r', cwd: '/w', featurePrompt: 'x', runId: 'run-cleanup-failure', pollMs: 1, maxWaitSec: 1,
      ptyAvailable: () => true,
      spawn: ((options: { env: Record<string, string> }) => {
        reportPath = options.env.MONAD_LIFECYCLE_ROOT_REPORT;
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, '{not-json');
        writeFileSync(`${reportPath}.interrupted.tmp`, 'partial');
        throw new Error('spawn failed');
      }) as never,
    })).rejects.toThrow('spawn failed');
    expect(existsSync(reportPath)).toBe(false);
    expect(existsSync(`${reportPath}.interrupted.tmp`)).toBe(false);
  });
});

describe('normalizeDeterministicCompletionState', () => {
  it('완료 정보량 경계는 완료 상태만 보존하고 나머지 FrameState를 보수적으로 unknown으로 정규화한다', () => {
    expect(normalizeDeterministicCompletionState('done')).toBe('done');
    expect(normalizeDeterministicCompletionState('working')).toBe('working');
    expect(normalizeDeterministicCompletionState('unknown')).toBe('unknown');
    expect(normalizeDeterministicCompletionState('blocked')).toBe('unknown');
    expect(normalizeDeterministicCompletionState('idle')).toBe('unknown');
  });
});


describe('runHeadlessGoalLoopPty — supervision vocabulary observation', () => {
  async function observeBrain(action: string, times: number[], autoStop = false): Promise<{ result: Awaited<ReturnType<typeof runHeadlessGoalLoopPty>>; observations: Record<string, unknown>[] }> {
    const observations: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'run-supervision.verdict') observations.push(data ?? {});
    }) as never);
    let index = 0;
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3,
        ptyAvailable: () => true,
        spawn: (() => fakeHandle('working screen', 'still working')) as never,
        brain: { decide: async () => ({ action, text: 'context', reason: 'done' }) } as never,
        autoStop: { enabled: autoStop, minRung: 2 },
        nowMs: () => times[Math.min(index++, times.length - 1)]!,
      });
      return { result, observations };
    } finally {
      log.mockRestore();
    }
  }

  it('done maps to complete without a confirmed stop and preserves the existing non-stop outcome', async () => {
    const { result, observations } = await observeBrain('done', [2_000]);
    expect(observations).toContainEqual(expect.objectContaining({ moment: 'in-round', action: 'done', applied: false, supervisionVerdict: 'complete' }));
    expect(result.exitReason).toBe('soft-timeout');
  });

  it('done maps to abandon only when the existing auto-stop is confirmed', async () => {
    const { result, observations } = await observeBrain('done', [2_000, 302_000], true);
    expect(observations).toContainEqual(expect.objectContaining({ action: 'done', applied: true, supervisionVerdict: 'abandon' }));
    expect(result.exitReason).toBe('brain-stop');
  });

  it('wait continues and input is assist(context)', async () => {
    const wait = await observeBrain('wait', [2_000]);
    const input = await observeBrain('input', [2_000]);
    expect(wait.observations).toContainEqual(expect.objectContaining({ action: 'wait', supervisionVerdict: 'continue' }));
    expect(input.observations).toContainEqual(expect.objectContaining({ action: 'input', supervisionVerdict: 'assist', supervisionAssistKind: 'context' }));
  });

  it('an unexpected runtime mapping is observed without changing the existing non-stop path', async () => {
    const { result, observations } = await observeBrain('unexpected-action', [2_000]);
    expect(observations).toContainEqual(expect.objectContaining({ action: 'unexpected-action', applied: false, supervisionMappingError: 'unexpected-supervision-verdict' }));
    expect(result.exitReason).toBe('soft-timeout');
  });

  it('lost control skips a brain suggestion and records synthetic wait supervision rather than abandoning the goal loop', async () => {
    const skips: Record<string, unknown>[] = [];
    const verdicts: Record<string, unknown>[] = [];
    const outcomes: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.skip') skips.push(data ?? {});
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
      if (event === 'brain.input-outcome') outcomes.push(data ?? {});
    }) as never);
    let brainCalls = 0;
    try {
      const handle = fakeHandle('working screen', 'still working') as { canWrite: () => boolean };
      handle.canWrite = () => false;
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3,
        ptyAvailable: () => true,
        spawn: (() => handle) as never,
        brain: { decide: async () => { brainCalls += 1; return { action: 'input', text: 'context', reason: 'x' }; } },
        nowMs: () => 2_000,
      });
      expect(brainCalls).toBe(0);
      expect(result.exitReason).toBe('soft-timeout');
      expect(skips).toContainEqual(expect.objectContaining({ stance: 'lost', supervisionVerdict: 'continue' }));
      expect(verdicts).toContainEqual(expect.objectContaining({ action: 'wait', evidenceWhy: 'action-wait', autoAssistOwnership: 'lost', supervisionVerdict: 'continue' }));
      expect(outcomes).toContainEqual(expect.objectContaining({ action: 'wait', evidenceWhy: 'action-wait' }));
    } finally {
      log.mockRestore();
    }
  });

  it('unknown control records the same synthetic wait supervision and PTY writes fail-closed', async () => {
    const skips: Record<string, unknown>[] = [];
    const verdicts: Record<string, unknown>[] = [];
    const outcomes: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.skip') skips.push(data ?? {});
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
      if (event === 'brain.input-outcome') outcomes.push(data ?? {});
    }) as never);
    let brainCalls = 0;
    let writes = 0;
    try {
      const handle = fakeHandle('working screen', 'still working') as { canWrite: () => boolean; write: () => void };
      handle.canWrite = () => { throw new Error('ownership probe unavailable'); };
      handle.write = () => { writes += 1; };
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3,
        ptyAvailable: () => true,
        spawn: (() => handle) as never,
        brain: { decide: async () => { brainCalls += 1; return { action: 'input', text: 'context', reason: 'x' }; } },
        autoAssist: { enabled: true, minRung: 0 },
        nowMs: () => 2_000,
      });
      expect(result.exitReason).toBe('soft-timeout');
    } finally {
      log.mockRestore();
    }
    expect(brainCalls).toBe(0);
    expect(writes).toBe(0);
    expect(skips).toContainEqual(expect.objectContaining({ stance: 'unknown', supervisionVerdict: 'continue' }));
    expect(verdicts).toContainEqual(expect.objectContaining({ action: 'wait', evidenceWhy: 'action-wait', autoAssistOwnership: 'unknown', supervisionVerdict: 'continue' }));
    expect(outcomes).toContainEqual(expect.objectContaining({ action: 'wait', evidenceWhy: 'action-wait' }));
  });

  it('argv child reports an undeliverable input suggestion and never writes, even when assist is enabled', async () => {
    const outcomes: Record<string, unknown>[] = [];
    const verdicts: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.input-outcome') outcomes.push(data ?? {});
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
    }) as never);
    let writes = 0;
    try {
      const handle = fakeHandle('working screen', 'still working') as { write: () => void };
      handle.write = () => { writes += 1; };
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3,
        ptyAvailable: () => true,
        spawn: (() => handle) as never,
        brain: { decide: async () => ({ action: 'input', text: 'context' }) },
        autoAssist: { enabled: true, minRung: 0 },
        nowMs: () => 2_000,
      });
      expect(result.exitReason).toBe('soft-timeout');
    } finally {
      log.mockRestore();
    }
    expect(writes).toBe(0);
    expect(outcomes).toContainEqual(expect.objectContaining({
      axis: 'assist', action: 'input', applied: false,
      why: 'child-cannot-receive-input', canReceiveInput: false,
    }));
    expect(verdicts).toContainEqual(expect.objectContaining({ action: 'input', applied: false, supervisionVerdict: 'assist', supervisionAssistKind: 'context' }));
  });

  it('without the assist flag, argv input preserves the existing verdict fields and timeout control flow', async () => {
    const verdicts: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/r', cwd: '/w', featurePrompt: 'x', pollMs: 1, maxWaitSec: 3,
        ptyAvailable: () => true,
        spawn: (() => fakeHandle('working screen', 'still working')) as never,
        brain: { decide: async () => ({ action: 'input', text: 'context' }) },
        nowMs: () => 2_000,
      });
      expect(result.exitReason).toBe('soft-timeout');
    } finally {
      log.mockRestore();
    }
    expect(verdicts).toContainEqual(expect.objectContaining({
      action: 'input', actionDetail: 'context', applied: false, why: 'disabled',
      supervisionVerdict: 'assist', supervisionAssistKind: 'context',
    }));
  });
});
