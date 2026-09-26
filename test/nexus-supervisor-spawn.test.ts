// NEXUS · supervisor spawn primitive tests (Phase N-2 PR ε)

import { describe, test, expect } from 'bun:test';
import { makeTestSpawnBackend } from '../src/nexus/supervisor/spawn.js';

describe('makeTestSpawnBackend · invocation capture', () => {
  test('records command/cwd/env per spawn', () => {
    const backend = makeTestSpawnBackend();
    backend.spawn({
      command: ['elanous', 'serve', '--gateway-mode'],
      cwd: '/tmp/work',
      env: { TOKEN: 'redacted' },
    });
    expect(backend.invocations).toHaveLength(1);
    expect(backend.invocations[0].command).toEqual(['elanous', 'serve', '--gateway-mode']);
    expect(backend.invocations[0].cwd).toBe('/tmp/work');
    expect(backend.invocations[0].env).toEqual({ TOKEN: 'redacted' });
  });

  test('pid sequence defaults to 10001+ ascending', () => {
    const backend = makeTestSpawnBackend();
    const a = backend.spawn({ command: ['/bin/true'] });
    const b = backend.spawn({ command: ['/bin/true'] });
    expect(a.pid).toBe(10001);
    expect(b.pid).toBe(10002);
  });

  test('pidSequence override is honored', () => {
    const backend = makeTestSpawnBackend();
    backend.pidSequence = [42, 99];
    expect(backend.spawn({ command: ['/bin/true'] }).pid).toBe(42);
    expect(backend.spawn({ command: ['/bin/true'] }).pid).toBe(99);
  });
});

describe('makeTestSpawnBackend · halt-pattern matching', () => {
  test('matched stderr line fires onHaltMatch exactly once', () => {
    const backend = makeTestSpawnBackend();
    const matches: { pattern: string; line: string }[] = [];
    const child = backend.spawn({
      command: ['next', 'dev'],
      haltPatterns: ['EADDRINUSE', 'Module not found'],
      onHaltMatch: (pattern, line) => matches.push({ pattern, line }),
    });
    child.emitStderr('warming up...');
    child.emitStderr('Error: listen EADDRINUSE: address already in use :::3000');
    child.emitStderr('Error: listen EADDRINUSE: still in use'); // already halted — ignored
    expect(matches).toHaveLength(1);
    expect(matches[0].pattern).toBe('EADDRINUSE');
    expect(child.haltMatched).toEqual({
      pattern: 'EADDRINUSE',
      line: 'Error: listen EADDRINUSE: address already in use :::3000',
    });
  });

  test('non-matching lines do not fire callback', () => {
    const backend = makeTestSpawnBackend();
    let fired = 0;
    const child = backend.spawn({
      command: ['svc'],
      haltPatterns: ['401', '403'],
      onHaltMatch: () => { fired += 1; },
    });
    child.emitStderr('OK 200');
    child.emitStderr('warning: latency high');
    expect(fired).toBe(0);
    expect(child.haltMatched).toBeNull();
  });

  test('invalid regex does not throw — silently skipped', () => {
    const backend = makeTestSpawnBackend();
    let fired = 0;
    const child = backend.spawn({
      command: ['svc'],
      haltPatterns: ['[unclosed', '401'],
      onHaltMatch: () => { fired += 1; },
    });
    expect(() => child.emitStderr('401 Unauthorized')).not.toThrow();
    expect(fired).toBe(1);
  });
});

describe('makeTestSpawnBackend · exit lifecycle', () => {
  test('emitExit fires onExit listeners exactly once', () => {
    const backend = makeTestSpawnBackend();
    const child = backend.spawn({ command: ['/bin/true'] });
    let received: { exitCode: number; signal?: NodeJS.Signals } | null = null;
    child.onExit((info) => { received = info; });
    child.emitExit({ exitCode: 137, signal: 'SIGKILL' });
    expect(received).toEqual({ exitCode: 137, signal: 'SIGKILL' });
    // re-emit is a no-op (idempotent)
    child.emitExit({ exitCode: 0 });
    expect(received).toEqual({ exitCode: 137, signal: 'SIGKILL' });
  });

  test('listener registered after exit is invoked synchronously', () => {
    const backend = makeTestSpawnBackend();
    const child = backend.spawn({ command: ['/bin/true'] });
    child.emitExit({ exitCode: 0 });
    let received: { exitCode: number } | null = null;
    child.onExit((info) => { received = info; });
    expect(received).toEqual({ exitCode: 0 });
  });

  test('unsubscribe removes the listener', () => {
    const backend = makeTestSpawnBackend();
    const child = backend.spawn({ command: ['/bin/true'] });
    let count = 0;
    const off = child.onExit(() => { count += 1; });
    off();
    child.emitExit({ exitCode: 0 });
    expect(count).toBe(0);
  });

  test('kill marks killed=true', () => {
    const backend = makeTestSpawnBackend();
    const child = backend.spawn({ command: ['/bin/true'] });
    expect(child.killed).toBe(false);
    child.kill('SIGTERM');
    expect(child.killed).toBe(true);
  });

  test('dispose clears listeners (subsequent emitExit is silent)', () => {
    const backend = makeTestSpawnBackend();
    const child = backend.spawn({ command: ['/bin/true'] });
    let count = 0;
    child.onExit(() => { count += 1; });
    child.dispose();
    child.emitExit({ exitCode: 0 });
    expect(count).toBe(0);
  });
});
