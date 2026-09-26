import { describe, expect, test } from 'bun:test';
import { defaultSeams } from '../src/self-implement/seams.js';
import { runHeadlessGoalLoopPty } from '../src/self-implement/headless-elanous-driver.js';

const prompt = '두 더하기 두는 얼마인가';
const configDir = '/tmp/elanous-config';
const stateDir = '/tmp/elanous-state';

function completedPty() {
  const handle = {
    id: 'self_test', cmd: 'bun', workdir: '/worktree', startedAt: 0, lastActivityAt: 0, detach: false,
    exitCode: null as number | null,
    isAlive: () => handle.exitCode === null,
    appendOutput() {},
    drainDelta() { handle.exitCode = 0; return ''; },
    snapshot: () => '',
    write() {}, kill() {}, resize() {},
    renderScreen: async () => '', renderScreenPng: async () => null,
  };
  return handle;
}

function expectImplementArgv(args: readonly string[], promptPrefix = prompt): void {
  expect(args.slice(1, 3)).toEqual(['dev', '--implement']);
  expect(args).toEqual(expect.arrayContaining(['--config-dir', configDir]));
  expect(args).not.toEqual(expect.arrayContaining(['chat', '--tools', '--goal-loop', '--new', '--cwd']));
  expect(args.at(-1)).toStartWith(promptPrefix);
}

describe('self-implement child argv uses dev --implement', () => {
  test('PTY child preserves positional prompt, config, cwd spawn option, and state environment', async () => {
    let captured: { args?: readonly string[]; workdir?: string; env?: NodeJS.ProcessEnv } = {};
    await runHeadlessGoalLoopPty({
      binRoot: '/repo', cwd: '/worktree', featurePrompt: prompt, configDir, stateDir, runId: 'run-argv',
      pollMs: 1, maxWaitSec: 1, ptyAvailable: () => true,
      spawn: ((options: { args: readonly string[]; workdir?: string; env?: NodeJS.ProcessEnv }) => {
        captured = options;
        return completedPty();
      }) as never,
    });

    expectImplementArgv(captured.args!);
    expect(captured.workdir).toBe('/worktree');
    expect(captured.env?.ELANOUS_STATE_DIR).toBe(stateDir);
    expect(captured.env).toEqual(expect.objectContaining({ ELANOUS_PTY_ID: expect.any(String) }));
  });

  test('spawnSync fallback preserves positional prompt, config, cwd spawn option, and state environment', async () => {
    let captured: { cmd?: string; args?: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv } = {};
    const seams = defaultSeams({
      configDir, stateDir, ptyAvailable: () => false,
      spawnSync: ((cmd: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
        captured = { cmd, args, ...options };
        return { status: 0, stdout: 'GOAL-COMPLETE\n', stderr: '', signal: null };
      }) as never,
    });

    await seams.implement!({ cwd: '/worktree', feature: prompt, runId: 'run-argv' });

    expect(captured.cmd).toBe('bun');
    expectImplementArgv(captured.args!);
    expect(captured.cwd).toBe('/worktree');
    expect(captured.env?.ELANOUS_STATE_DIR).toBe(stateDir);
    expect(captured.env).toEqual(expect.objectContaining({ ELANOUS_HARNESS_SPACE: expect.any(String) }));
  });

});
