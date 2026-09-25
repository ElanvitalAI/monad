// ── C1 (Phase 3 Bundle 3) — shell-channel-orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createShellChannelOrchestrator,
  type ChannelCommand,
  type ChannelPost,
} from '../../src/discord/shell-channel-orchestrator';
import type { ShellHandle, ShellRegistry, ShellResult } from '../../src/shell-runner/types';

function fakeRegistry(): ShellRegistry {
  return {
    register: () => {},
    unregister: () => {},
    get: () => null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture: () => () => {},
  } as unknown as ShellRegistry;
}

function fakeHandle(opts: { id?: string; result?: ShellResult } = {}): ShellHandle {
  return {
    id: opts.id ?? 'sh-1',
    mode: 'vw',
    status: 'completed',
    result: opts.result ? Promise.resolve(opts.result) : new Promise(() => {}),
  } as unknown as ShellHandle;
}

const CMD: ChannelCommand = {
  channel: { id: 'ch-1', name: 'dev-ops' },
  userId: 'user-1',
  username: 'alice',
  verb: 'build',
};

describe('createShellChannelOrchestrator — happy path', () => {
  test('allow → spawn + post result', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle({
        id: 'sh-99',
        result: {
          exitCode: 0,
          stdout: { text: '' },
          stderr: { text: '' },
          aggregated: { text: 'build success' },
          durationMs: 1234,
          timedOut: false,
          interrupted: false,
          truncated: false,
          outcome: 'exit',
        } as ShellResult,
      }),
      resolveCommand: () => ({ kind: 'allow', request: { command: 'npm run build' } }),
      channelPost: async (p) => { posts.push(p); },
    });
    const r = await o.handleCommand(CMD);
    expect(r.outcome).toBe('spawned');
    expect(r.shellId).toBe('sh-99');
    // Wait microtask + result Promise
    await new Promise((r) => setTimeout(r, 30));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.message).toContain('build');
    expect(posts[0]!.message).toContain('exit 0');
    expect(posts[0]!.message).toContain('@alice');
  });
});

describe('createShellChannelOrchestrator — denied / unknown', () => {
  test('deny → channel post + outcome=denied', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle(),
      resolveCommand: () => ({ kind: 'deny', reason: 'no grant' }),
      channelPost: async (p) => { posts.push(p); },
    });
    const r = await o.handleCommand(CMD);
    expect(r.outcome).toBe('denied');
    expect(r.reason).toBe('no grant');
    expect(posts[0]!.message).toContain('🚫');
  });

  test('unknown verb → channel post + outcome=unknown', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle(),
      resolveCommand: () => ({ kind: 'unknown' }),
      channelPost: async (p) => { posts.push(p); },
    });
    const r = await o.handleCommand({ ...CMD, verb: 'foobar' });
    expect(r.outcome).toBe('unknown');
    expect(posts[0]!.message).toContain('foobar');
  });
});

describe('createShellChannelOrchestrator — spawn failure', () => {
  test('spawnShell returns null → outcome=spawn-failed + channel post', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      resolveCommand: () => ({ kind: 'allow', request: { command: 'pwd' } }),
      channelPost: async (p) => { posts.push(p); },
    });
    const r = await o.handleCommand(CMD);
    expect(r.outcome).toBe('spawn-failed');
    expect(posts[0]!.message).toContain('failed');
  });
});

describe('createShellChannelOrchestrator — budget elapsed', () => {
  test('shell still running past budget → "still running" channel post', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle({ id: 'long' }),
      resolveCommand: () => ({ kind: 'allow', request: { command: 'sleep 100' } }),
      channelPost: async (p) => { posts.push(p); },
      resultBudgetMs: 50,
    });
    await o.handleCommand(CMD);
    await new Promise((r) => setTimeout(r, 80));
    expect(posts[0]!.message).toContain('안 끝남');
    expect(posts[0]!.message).toContain('long');
  });
});

describe('createShellChannelOrchestrator — composer override', () => {
  test('custom composeResult honored', async () => {
    const posts: ChannelPost[] = [];
    const o = createShellChannelOrchestrator({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle({
        result: {
          exitCode: 0, stdout: { text: '' }, stderr: { text: '' },
          aggregated: { text: '' }, durationMs: 0, timedOut: false,
          interrupted: false, truncated: false, outcome: 'exit',
        } as ShellResult,
      }),
      resolveCommand: () => ({ kind: 'allow', request: { command: 'pwd' } }),
      channelPost: async (p) => { posts.push(p); },
      composeResult: () => 'CUSTOM',
    });
    await o.handleCommand(CMD);
    await new Promise((r) => setTimeout(r, 20));
    expect(posts[0]!.message).toBe('CUSTOM');
  });
});
