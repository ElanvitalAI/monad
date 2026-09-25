// PR-S1V.6 (sprint 22 Phase 1) — audio-player.ts subprocess lifecycle.
//
// Uses the `spawnFn` inject seam (CLAUDE.md prefers real wiring or
// spyOn over mock.module) so each test sees a fake `play` subprocess
// without touching the actual sox binary.

import { afterEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createAudioPlayer, DEFAULT_PCM_SAMPLE_RATE } from '../src/voice/playback/audio-player.js';

interface FakeChildSpawn {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  on(event: string, cb: (...args: unknown[]) => void): FakeChildSpawn;
  kill(signal?: string): boolean;
  emitClose(code: number, signal?: string | null): void;
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  child: FakeChildSpawn;
}

function createFakeSpawnFactory() {
  const calls: SpawnCall[] = [];
  const spawnFn = ((command: string, args: readonly string[]) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    const child: FakeChildSpawn = {
      stdin, stdout, stderr,
      pid: 99000 + calls.length,
      on(event, cb) { emitter.on(event, cb); return child; },
      kill() { return true; },
      emitClose(code, signal = null) { emitter.emit('close', code, signal); },
    };
    calls.push({ command, args, child });
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawnFn, calls };
}

afterEach(() => {
  // No global state to reset — createAudioPlayer keeps its own closure.
});

describe('createAudioPlayer', () => {
  it('spawns play with the requested PCM format args', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    const ok = await player.start({ sampleRate: 22050, channels: 1, bitsPerSample: 16 });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [{ command, args }] = calls;
    expect(command).toBe('play');
    expect(args).toContain('-q');
    expect(args).toContain('-t'); expect(args).toContain('raw');
    expect(args).toContain('-r'); expect(args).toContain('22050');
    expect(args).toContain('-e'); expect(args).toContain('signed');
    expect(args).toContain('-b'); expect(args).toContain('16');
    expect(args).toContain('-c'); expect(args).toContain('1');
    expect(args[args.length - 1]).toBe('-');
    // Cleanup
    calls[0]!.child.emitClose(0);
    await player.drain();
  });

  it('uses default 24000 Hz when no opts passed', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    expect(calls[0]!.args).toContain(String(DEFAULT_PCM_SAMPLE_RATE));
    calls[0]!.child.emitClose(0);
    await player.drain();
  });

  it('rejects start() while another player is active', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    const second = await player.start();
    expect(second).toBe(false);
    expect(calls).toHaveLength(1);
    calls[0]!.child.emitClose(0);
    await player.drain();
  });

  it('push() writes to stdin and returns true while playing', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    const received: Buffer[] = [];
    calls[0]!.child.stdin.on('data', (chunk: Buffer) => received.push(chunk));
    const a = player.push(Buffer.from([1, 2, 3, 4]));
    const b = player.push(Buffer.from([5, 6]));
    expect(a).toBe(true);
    expect(b).toBe(true);
    // Allow PassThrough flush
    await new Promise((r) => setImmediate(r));
    const concat = Buffer.concat(received);
    expect(concat).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
    calls[0]!.child.emitClose(0);
    await player.drain();
  });

  it('push() returns false before start and after drain', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    expect(player.push(Buffer.from([1]))).toBe(false);
    await player.start();
    expect(player.push(Buffer.from([1]))).toBe(true);
    // Trigger natural close after drain
    queueMicrotask(() => calls[0]!.child.emitClose(0));
    await player.drain();
    expect(player.push(Buffer.from([1]))).toBe(false);
  });

  it('drain() awaits subprocess close', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    let resolved = false;
    const drained = player.drain().then(() => { resolved = true; });
    // Give drain() a tick to call stdin.end() and start awaiting close
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    calls[0]!.child.emitClose(0);
    await drained;
    expect(resolved).toBe(true);
    expect(player.isPlaying()).toBe(false);
  });

  it('stop() SIGTERMs the subprocess and resolves on close', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    let killSignal: string | undefined;
    calls[0]!.child.kill = (signal?: string) => { killSignal = signal; return true; };
    const stopped = player.stop();
    // Simulate subprocess exiting after SIGTERM
    queueMicrotask(() => calls[0]!.child.emitClose(143, 'SIGTERM'));
    await stopped;
    expect(killSignal).toBe('SIGTERM');
    expect(player.isPlaying()).toBe(false);
  });

  it('isPlaying() reflects start/close lifecycle', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    expect(player.isPlaying()).toBe(false);
    await player.start();
    expect(player.isPlaying()).toBe(true);
    calls[0]!.child.emitClose(0);
    await player.drain();
    expect(player.isPlaying()).toBe(false);
  });

  it('player can be reused after drain', async () => {
    const { spawnFn, calls } = createFakeSpawnFactory();
    const player = createAudioPlayer({ spawnFn });
    await player.start();
    queueMicrotask(() => calls[0]!.child.emitClose(0));
    await player.drain();

    const ok = await player.start();
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    calls[1]!.child.emitClose(0);
    await player.drain();
  });
});
