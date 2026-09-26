import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  childPtyIdentityEnv,
  getCurrentPtyId,
  getParentPtyId,
  withChildPtyIdentity,
} from '../src/agent/pty-identity.js';
import { runHeadlessGoalLoopPty } from '../src/self-implement/headless-elanous-driver.js';
import { codexBackend, runAgentMission } from '../src/agent-mission/driver.js';

const saved = {
  pty: process.env.ELANOUS_PTY_ID,
  parent: process.env.ELANOUS_PARENT_PTY_ID,
  chainOrigin: process.env.ELANOUS_PTY_CHAIN_ORIGIN,
  chainDepth: process.env.ELANOUS_PTY_CHAIN_DEPTH,
  nestDepth: process.env.ELANOUS_NEST_DEPTH,
};

afterEach(() => {
  if (saved.pty === undefined) delete process.env.ELANOUS_PTY_ID;
  else process.env.ELANOUS_PTY_ID = saved.pty;
  if (saved.parent === undefined) delete process.env.ELANOUS_PARENT_PTY_ID;
  else process.env.ELANOUS_PARENT_PTY_ID = saved.parent;
  if (saved.chainOrigin === undefined) delete process.env.ELANOUS_PTY_CHAIN_ORIGIN;
  else process.env.ELANOUS_PTY_CHAIN_ORIGIN = saved.chainOrigin;
  if (saved.chainDepth === undefined) delete process.env.ELANOUS_PTY_CHAIN_DEPTH;
  else process.env.ELANOUS_PTY_CHAIN_DEPTH = saved.chainDepth;
  if (saved.nestDepth === undefined) delete process.env.ELANOUS_NEST_DEPTH;
  else process.env.ELANOUS_NEST_DEPTH = saved.nestDepth;
});

describe('PTY identity propagation', () => {
  test('reads unset and set process PTY identity', () => {
    delete process.env.ELANOUS_PTY_ID;
    delete process.env.ELANOUS_PARENT_PTY_ID;
    expect(getCurrentPtyId()).toBeUndefined();
    expect(getParentPtyId()).toBeUndefined();

    process.env.ELANOUS_PTY_ID = 'self_deadbeef';
    process.env.ELANOUS_PARENT_PTY_ID = 'shell_cafebabe';
    expect(getCurrentPtyId()).toBe('self_deadbeef');
    expect(getParentPtyId()).toBe('shell_cafebabe');
  });

  test('child env always contains its PTY, execution-chain identity, and parent only when known', () => {
    delete process.env.ELANOUS_PTY_ID;
    delete process.env.ELANOUS_PTY_CHAIN_ORIGIN;
    delete process.env.ELANOUS_PTY_CHAIN_DEPTH;
    expect(childPtyIdentityEnv('self_deadbeef')).toEqual({
      ELANOUS_PTY_ID: 'self_deadbeef',
      ELANOUS_PTY_CHAIN_ORIGIN: process.cwd().split('/').at(-1) ?? process.cwd(),
    });

    process.env.ELANOUS_PTY_ID = 'self_parent01';
    process.env.ELANOUS_PTY_CHAIN_ORIGIN = 'headless-root';
    process.env.ELANOUS_PTY_CHAIN_DEPTH = '2';
    expect(childPtyIdentityEnv('self_deadbeef')).toEqual({
      ELANOUS_PTY_ID: 'self_deadbeef',
      ELANOUS_PARENT_PTY_ID: 'self_parent01',
      ELANOUS_PTY_CHAIN_ORIGIN: 'headless-root',
    });
  });

  test('withChildPtyIdentity strips stale parent and legacy duplicate-depth keys when the current process has no PTY', () => {
    delete process.env.ELANOUS_PTY_ID;
    process.env.ELANOUS_NEST_DEPTH = '2';
    const merged = withChildPtyIdentity(
      {
        KEEP: 'me',
        ELANOUS_PARENT_PTY_ID: 'stale_00000000',
        ELANOUS_PTY_ID: 'stale_pty00000',
        ELANOUS_PTY_CHAIN_DEPTH: '99',
        ELANOUS_NEST_DEPTH: '2',
      },
      'codex_deadbeef',
    );
    expect(merged.KEEP).toBe('me');
    expect(merged.ELANOUS_PTY_ID).toBe('codex_deadbeef');
    expect(merged.ELANOUS_NEST_DEPTH).toBe('2');
    expect('ELANOUS_PARENT_PTY_ID' in merged).toBe(false);
    expect('ELANOUS_PTY_CHAIN_DEPTH' in merged).toBe(false);
  });

  test('withChildPtyIdentity overwrites a stale parent with the current PTY as the new parent', () => {
    process.env.ELANOUS_PTY_ID = 'self_parent01';
    const merged = withChildPtyIdentity(
      { KEEP: 'me', ELANOUS_PARENT_PTY_ID: 'stale_00000000' },
      'codex_deadbeef',
    );
    expect(merged.KEEP).toBe('me');
    expect(merged.ELANOUS_PTY_ID).toBe('codex_deadbeef');
    expect(merged.ELANOUS_PARENT_PTY_ID).toBe('self_parent01');
  });

  test('runAgentMission does not leak a stale parent PTY id when the current process has no PTY', async () => {
    delete process.env.ELANOUS_PTY_ID;
    process.env.ELANOUS_PARENT_PTY_ID = 'stale_00000000';
    const worktree = mkdtempSync(join(tmpdir(), 'mission-pty-stale-'));
    const evidence = join(worktree, 'evidence.md');
    writeFileSync(evidence, 'ready');
    let captured: { id?: string; env?: Record<string, string> } | undefined;
    let recordedProvenance: { path: string; owner: string } | undefined;
    const handle = {
      id: 'codex_fake000', kind: 'codex', nickname: 'mission', cmd: 'codex', workdir: worktree,
      startedAt: 0, lastActivityAt: 0, detach: false, exitCode: 0 as number | null, exitSignal: undefined,
      accessMode: 'auto', transitionPolicy: 'open', isAlive: () => false,
      appendOutput() {}, drainDelta: () => '', snapshot: () => '', write() {}, kill() {}, resize() {},
      setAccessMode: () => true, setTransitionPolicy() {}, setNickname() {}, canWrite: () => true,
      renderScreen: async () => '', renderScreenPng: async () => null,
    };

    try {
      await runAgentMission({
        mission: 'verify wiring', repo: worktree, branch: 'test-mission', agent: codexBackend,
        evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' },
        maxRounds: 0, commit: false, memory: false,
      }, {
        createWorktree: (() => ({ path: worktree, branch: 'test-mission', base: 'HEAD' })) as never,
        recordWorktreeProvenance: ((path: string, provenance: { owner: string }) => {
          recordedProvenance = { path, owner: provenance.owner };
        }) as never,
        startPty: ((options: { id?: string; env?: Record<string, string> }) => {
          captured = options;
          return { ...handle, id: options.id! };
        }) as never,
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }

    expect(captured?.id).toMatch(/^codex_[0-9a-f]{8}$/);
    expect(captured?.env?.ELANOUS_PTY_ID).toBe(captured?.id);
    expect(captured?.env && 'ELANOUS_PARENT_PTY_ID' in captured.env).toBe(false);
    expect(recordedProvenance).toEqual({ path: worktree, owner: 'agent:test-mission' });
  });

  test('runAgentMission binds its actual preallocated PTY id and parent identity at the injected startPty seam', async () => {
    process.env.ELANOUS_PTY_ID = 'shell_cafebabe';
    const worktree = mkdtempSync(join(tmpdir(), 'mission-pty-identity-'));
    const evidence = join(worktree, 'evidence.md');
    writeFileSync(evidence, 'ready');
    let captured: { id?: string; env?: Record<string, string> } | undefined;
    let recordedProvenance: { path: string; owner: string } | undefined;
    const handle = {
      id: 'codex_fake000', kind: 'codex', nickname: 'mission', cmd: 'codex', workdir: worktree,
      startedAt: 0, lastActivityAt: 0, detach: false, exitCode: 0 as number | null, exitSignal: undefined,
      accessMode: 'auto', transitionPolicy: 'open', isAlive: () => false,
      appendOutput() {}, drainDelta: () => '', snapshot: () => '', write() {}, kill() {}, resize() {},
      setAccessMode: () => true, setTransitionPolicy() {}, setNickname() {}, canWrite: () => true,
      renderScreen: async () => '', renderScreenPng: async () => null,
    };

    try {
      await runAgentMission({
        mission: 'verify wiring', repo: worktree, branch: 'test-mission', agent: codexBackend,
        evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' },
        maxRounds: 0, commit: false, memory: false,
      }, {
        createWorktree: (() => ({ path: worktree, branch: 'test-mission', base: 'HEAD' })) as never,
        recordWorktreeProvenance: ((path: string, provenance: { owner: string }) => {
          recordedProvenance = { path, owner: provenance.owner };
        }) as never,
        startPty: ((options: { id?: string; env?: Record<string, string> }) => {
          captured = options;
          return { ...handle, id: options.id! };
        }) as never,
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }

    expect(captured?.id).toMatch(/^codex_[0-9a-f]{8}$/);
    expect(captured?.env?.ELANOUS_PTY_ID).toBe(captured?.id);
    expect(captured?.env?.ELANOUS_PARENT_PTY_ID).toBe('shell_cafebabe');
    expect(recordedProvenance).toEqual({ path: worktree, owner: 'agent:test-mission' });
  });

  test('headless goal-loop captures an id that exactly matches its child env identity', async () => {
    process.env.ELANOUS_PTY_ID = 'shell_cafebabe';
    let captured: { id?: string; env?: Record<string, string> } | undefined;
    const handle = {
      id: 'self_fake000', cmd: 'bun', workdir: '/work', startedAt: 0, lastActivityAt: 0, detach: false,
      exitCode: 0 as number | null, exitSignal: undefined, accessMode: 'auto', transitionPolicy: 'open',
      isAlive: () => false, appendOutput() {}, drainDelta: () => '', snapshot: () => '', write() {}, kill() {}, resize() {},
      setAccessMode: () => true, setTransitionPolicy() {}, canWrite: () => true,
      renderScreen: async () => '', renderScreenPng: async () => null,
    };
    const spawn = ((options: { id?: string; env?: Record<string, string> }) => {
      captured = options;
      return { ...handle, id: options.id! };
    }) as never;

    await runHeadlessGoalLoopPty({
      binRoot: '/repo', cwd: '/work', featurePrompt: 'work', pollMs: 1, maxWaitSec: 1,
      spawn, ptyAvailable: () => true,
    });

    expect(captured?.id).toMatch(/^self_[0-9a-f]{8}$/);
    expect(captured?.env?.ELANOUS_PTY_ID).toBe(captured?.id);
    expect(captured?.env?.ELANOUS_PARENT_PTY_ID).toBe('shell_cafebabe');
  });
});
