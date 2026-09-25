import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { createFileCaptureEngine } from '../../src/shell-runner/file-engine.js';
import type { RunCtx } from '../../src/shell-runner/types.js';

// ── fake child_process.spawn ────────────────────────────────────
//
// The engine only uses: { stdout, stderr, stdin, kill, on('error'),
// once('exit') }. We emulate just that.

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  killed: boolean;
  lastSignal?: NodeJS.Signals | number;
}

function fakeSpawn(): {
  spawn: any;
  // handles returned in spawn order
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const spawn = (_cmd: string, _args: readonly string[]) => {
    const ee = new EventEmitter() as FakeChild;
    ee.stdout = new PassThrough();
    ee.stderr = new PassThrough();
    ee.stdin = new PassThrough();
    ee.killed = false;
    ee.kill = (signal) => {
      ee.killed = true;
      ee.lastSignal = signal;
      return true;
    };
    children.push(ee);
    return ee;
  };
  return { spawn: spawn as any, children };
}

const ctx: RunCtx = { getCwd: () => '/tmp' };

async function drain(ms = 20) {
  await new Promise(r => setTimeout(r, ms));
}

describe('FileCaptureEngine', () => {
  test('captures stdout on normal exit 0', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'echo hi', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    child.stdout.write('hello\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    const r = await h.result;
    expect(r.exitCode).toBe(0);
    expect(r.outcome).toBe('exit');
    expect(r.stdout.text).toContain('hello');
    expect(r.stderr.text).toBe('');
    expect(r.interrupted).toBe(false);
  });

  test('stderr is captured separately from stdout', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    child.stdout.write('OUT\n');
    child.stderr.write('ERR\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    const r = await h.result;
    expect(r.stdout.text).toContain('OUT');
    expect(r.stderr.text).toContain('ERR');
    expect(r.aggregated.text).toContain('OUT');
    expect(r.aggregated.text).toContain('ERR');
  });

  test('non-zero exit preserves code', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'false', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 1, null);
    const r = await h.result;
    expect(r.exitCode).toBe(1);
  });

  test('signal-terminated child reports 128+signo', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGTERM');
    const r = await h.result;
    expect(r.exitCode).toBe(143);
  });

  test('kill() sends SIGTERM and marks interrupted', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 60_000 }, ctx);
    const child = children[0]!;
    h.kill();
    expect(child.lastSignal).toBe('SIGTERM');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGTERM');
    const r = await h.result;
    expect(r.interrupted).toBe(true);
    expect(r.outcome).toBe('aborted');
  });

  test('kill(SIGKILL) forwards the exact signal', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 60_000 }, ctx);
    const child = children[0]!;
    h.kill('SIGKILL');
    expect(child.lastSignal).toBe('SIGKILL');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGKILL');
    await h.result;
  });

  test('timeout → timedOut + SIGTERM sent', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'sleep 100', timeoutMs: 40 }, ctx);
    const child = children[0]!;
    await drain(80);
    expect(child.lastSignal).toBe('SIGTERM');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGTERM');
    const r = await h.result;
    expect(r.timedOut).toBe(true);
    expect(r.outcome).toBe('timeout');
  });

  test('spawn-error path sets outcome=spawn-error', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'missing', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    child.emit('error', new Error('ENOENT'));
    const r = await h.result;
    expect(r.outcome).toBe('spawn-error');
  });

  test('onChunk distinguishes stdout vs stderr in real time', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    const seen: Array<[string, string]> = [];
    h.onChunk(c => seen.push([c.stream, c.bytes]));
    child.stdout.write('a');
    child.stderr.write('b');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    await h.result;
    expect(seen).toContainEqual(['stdout', 'a']);
    expect(seen).toContainEqual(['stderr', 'b']);
  });

  test('stdin is piped to the child and closed', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'cat', timeoutMs: 5000, stdin: 'hello\n' }, ctx);
    const child = children[0]!;
    const seen: string[] = [];
    child.stdin.on('data', (b: Buffer) => seen.push(b.toString('utf8')));
    await drain(5);
    expect(seen.join('')).toBe('hello\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    await h.result;
  });

  test('disk spill triggers when output > maxMemoryBytes', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({
      spawnFn: spawn,
      maxMemoryBytes: 100, // trivially small
    });
    const h = engine.run({ command: 'x', timeoutMs: 5000 }, ctx);
    const child = children[0]!;
    for (let i = 0; i < 20; i++) child.stdout.write('x'.repeat(20) + '\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    const r = await h.result;
    expect(r.outputFilePath).toBeTruthy();
  });

  test('output >maxOutputBytes is head+tail truncated', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 5000, maxOutputBytes: 40 }, ctx);
    const child = children[0]!;
    child.stdout.write('A'.repeat(30));
    child.stdout.write('B'.repeat(30));
    child.stdout.write('C'.repeat(30));
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    const r = await h.result;
    expect(r.truncated).toBe(true);
    expect(r.stdout.truncatedAfterBytes).toBe(20);
    expect(r.stdout.tail).toBeTruthy();
  });

  test('AbortSignal kills the child', async () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const ac = new AbortController();
    const h = engine.run({ command: 'x', timeoutMs: 60_000, signal: ac.signal }, ctx);
    const child = children[0]!;
    ac.abort();
    expect(child.lastSignal).toBe('SIGTERM');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', null, 'SIGTERM');
    const r = await h.result;
    expect(r.interrupted).toBe(true);
    expect(r.outcome).toBe('aborted');
  });

  test('background() flips status only', () => {
    const { spawn, children } = fakeSpawn();
    const engine = createFileCaptureEngine({ spawnFn: spawn });
    const h = engine.run({ command: 'x', timeoutMs: 60_000 }, ctx);
    const child = children[0]!;
    expect(h.background()).toBe(true);
    expect(h.status).toBe('backgrounded');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
  });

  test('array command skips the shell and uses argv directly', async () => {
    const observed: Array<{ cmd: string; args: readonly string[] }> = [];
    const { children } = fakeSpawn();
    const spawnFn: any = (cmd: string, args: readonly string[]) => {
      observed.push({ cmd, args });
      const ee = new EventEmitter() as any;
      ee.stdout = new PassThrough();
      ee.stderr = new PassThrough();
      ee.stdin = new PassThrough();
      ee.kill = () => true;
      children.push(ee);
      return ee;
    };
    const engine = createFileCaptureEngine({ spawnFn });
    const h = engine.run({ command: ['node', '-v'], timeoutMs: 1000 }, ctx);
    expect(observed[0]?.cmd).toBe('node');
    expect(observed[0]?.args).toEqual(['-v']);
    const child = children.at(-1)!;
    child.stdout.write('v22\n');
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', 0, null);
    await h.result;
  });
});
