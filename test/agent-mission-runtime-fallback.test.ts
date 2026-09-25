import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentMission } from '../src/agent-mission/driver.js';

function handle(worktree: string, id: string) {
  return {
    id, kind: 'codex', nickname: 'mission', cmd: 'codex', workdir: worktree,
    startedAt: 0, lastActivityAt: 0, detach: false, exitCode: 0 as number | null, exitSignal: undefined,
    accessMode: 'auto', transitionPolicy: 'open', isAlive: () => false,
    appendOutput() {}, drainDelta: () => '', snapshot: () => '', write() {}, kill() {}, resize() {},
    setAccessMode: () => true, setTransitionPolicy() {}, setNickname() {}, canWrite: () => true,
    renderScreen: async () => '', renderScreenPng: async () => null,
  };
}

describe('runAgentMission runtime fallback wiring', () => {
  test('rate-limit termination re-resolves fallback and starts the selected next backend once', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'mission-rate-limit-'));
    writeFileSync(join(worktree, 'evidence.md'), 'ready');
    const spawns: string[] = [];
    const fallbackInputs: unknown[] = [];
    let controls = 0;
    try {
      await runAgentMission({ mission: 'x', repo: worktree, branch: 'rate-limit', evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' }, maxRounds: 0, commit: false, memory: false }, {
        createWorktree: (() => ({ path: worktree, branch: 'rate-limit', base: 'HEAD' })) as never,
        recordWorktreeProvenance: (() => {}) as never,
        startPty: ((opts: { id: string; kind: string }) => { spawns.push(opts.kind); return handle(worktree, opts.id); }) as never,
        runControlLoop: (async () => ({ termination: controls++ === 0
          ? { kind: 'error', message: 'rate limit reached' }
          : { kind: 'success', reason: 'done' }, steps: 0 })) as never,
        resolveRunFallback: ((input) => { fallbackInputs.push(input); return { action: 'switch-backend', backend: 'grok' }; }),
      });
    } finally { rmSync(worktree, { recursive: true, force: true }); }
    expect(fallbackInputs).toEqual([{ currentStep: 'codex-rotate', currentCredentialRateLimited: true }]);
    expect(spawns).toEqual(['codex', 'grok']);
  });

  test('a repeated rate limit does not revisit an attempted chain slot', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'mission-repeat-rate-limit-'));
    writeFileSync(join(worktree, 'evidence.md'), 'ready');
    const spawns: string[] = [];
    let fallbackCalls = 0;
    let controls = 0;
    try {
      await runAgentMission({ mission: 'x', repo: worktree, branch: 'repeat-rate-limit', evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' }, maxRounds: 0, commit: false, memory: false }, {
        createWorktree: (() => ({ path: worktree, branch: 'repeat-rate-limit', base: 'HEAD' })) as never,
        recordWorktreeProvenance: (() => {}) as never,
        startPty: ((opts: { id: string; kind: string }) => { spawns.push(opts.kind); return handle(worktree, opts.id); }) as never,
        runControlLoop: (async () => ({ termination: { kind: 'error', message: 'rate limit reached' }, steps: controls++ })) as never,
        resolveRunFallback: (() => { fallbackCalls += 1; return { action: 'switch-backend', backend: 'grok' }; }),
      });
    } finally { rmSync(worktree, { recursive: true, force: true }); }
    expect(fallbackCalls).toBe(1);
    expect(spawns).toEqual(['codex', 'grok']);
  });

  test('chain exhaustion stays on the current backend without a retry', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'mission-chain-exhausted-'));
    writeFileSync(join(worktree, 'evidence.md'), 'ready');
    const spawns: string[] = [];
    let fallbackCalls = 0;
    try {
      await runAgentMission({ mission: 'x', repo: worktree, branch: 'chain-exhausted', evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' }, maxRounds: 0, commit: false, memory: false }, {
        createWorktree: (() => ({ path: worktree, branch: 'chain-exhausted', base: 'HEAD' })) as never,
        recordWorktreeProvenance: (() => {}) as never,
        startPty: ((opts: { id: string; kind: string }) => { spawns.push(opts.kind); return handle(worktree, opts.id); }) as never,
        runControlLoop: (async () => ({ termination: { kind: 'error', message: 'rate limit reached' }, steps: 0 })) as never,
        resolveRunFallback: (() => { fallbackCalls += 1; return { action: 'stay' }; }),
      });
    } finally { rmSync(worktree, { recursive: true, force: true }); }
    expect(fallbackCalls).toBe(1);
    expect(spawns).toEqual(['codex']);
  });

  test('non-rate-limit termination does not resolve fallback or start another backend', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'mission-non-rate-limit-'));
    writeFileSync(join(worktree, 'evidence.md'), 'ready');
    const spawns: string[] = [];
    let fallbackCalls = 0;
    try {
      await runAgentMission({ mission: 'x', repo: worktree, branch: 'non-rate-limit', evidence: { kind: 'doc', glob: /^evidence\.md$/, dirRel: '.' }, maxRounds: 0, commit: false, memory: false }, {
        createWorktree: (() => ({ path: worktree, branch: 'non-rate-limit', base: 'HEAD' })) as never,
        recordWorktreeProvenance: (() => {}) as never,
        startPty: ((opts: { id: string; kind: string }) => { spawns.push(opts.kind); return handle(worktree, opts.id); }) as never,
        runControlLoop: (async () => ({ termination: { kind: 'error', message: 'invalid request' }, steps: 0 })) as never,
        resolveRunFallback: (() => { fallbackCalls += 1; return { action: 'switch-backend', backend: 'grok' }; }),
      });
    } finally { rmSync(worktree, { recursive: true, force: true }); }
    expect(fallbackCalls).toBe(0);
    expect(spawns).toEqual(['codex']);
  });
});
