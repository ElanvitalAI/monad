// SP-E — RunnerHostFactory.onSpawnError hook.

import { describe, expect, test } from 'bun:test';

import { createRunnerHostFactory } from '../src/shell-runner/runner-host-factory.js';
import type { ShellRequest } from '../src/shell-runner/types.js';

function req(overrides: Partial<ShellRequest> = {}): ShellRequest {
  return {
    command: ['echo', 'hi'],
    mode: 'vw',
    ...overrides,
  };
}

describe('SP-E — onSpawnError hook', () => {
  test('fires with label + caught error when terminalFactory throws', () => {
    const errors: Array<{ label: string; msg: string }> = [];
    const factory = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      initialSize: () => ({ cols: 80, rows: 24 }),
      terminalFactory: () => { throw new Error('no bash'); },
      onSpawnError: (label, err) => errors.push({
        label,
        msg: err instanceof Error ? err.message : String(err),
      }),
    });
    const host = factory.factory(req());
    expect(host).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.label).toBe('runner');
    expect(errors[0]!.msg).toBe('no bash');
  });

  test('custom vw label propagates to the hook', () => {
    const labels: string[] = [];
    const factory = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      initialSize: () => ({ cols: 80, rows: 24 }),
      terminalFactory: () => { throw new Error('boom'); },
      onSpawnError: (label) => labels.push(label),
    });
    factory.factory(req({ vw: { windowLabel: 'deploy' } }));
    expect(labels).toEqual(['deploy']);
  });

  test('success path does NOT fire onSpawnError', () => {
    const calls: string[] = [];
    const fakeHost = {
      isAlive: true,
      write() { /* noop */ },
      resize() { /* noop */ },
      stop() { /* noop */ },
      render: () => '',
      onData: () => () => {},
      start: () => {},
    };
    const factory = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      initialSize: () => ({ cols: 80, rows: 24 }),
      terminalFactory: () => fakeHost as any,
      onSpawnError: (label) => calls.push(label),
    });
    const host = factory.factory(req());
    expect(host).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test('throwing inside the hook is isolated (still returns null)', () => {
    const factory = createRunnerHostFactory({
      getSessionCwd: () => '/tmp',
      initialSize: () => ({ cols: 80, rows: 24 }),
      terminalFactory: () => { throw new Error('x'); },
      onSpawnError: () => { throw new Error('hook boom'); },
    });
    // Must not propagate.
    const host = factory.factory(req());
    expect(host).toBeNull();
  });
});
