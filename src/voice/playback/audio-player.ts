// PR-S1V.6 (sprint 22 Phase 1 · 2026-04-29) — Subprocess audio playback
// for streaming TTS PCM.
//
// Mirrors `src/voice/audio-capture.ts` shape: a long-lived sox subprocess
// reads raw PCM from stdin and renders it through the system default
// audio device. TTS providers push 24 kHz · 16-bit signed mono PCM
// chunks while synthesis is in flight, then call `drain()` to flush
// the last chunk and let `play` exit naturally — the stream contract
// matches OpenAI TTS `response_format=pcm` and lines up with the
// resampling target every other provider produces.
//
// Reference: ROADMAP-voice-harness-bidirectional §2.1 · PLAN §6.1.
//
// Why a single subprocess instead of audio-buffer libraries:
//   - Bun's bundled `Bun.spawn` is well-trodden in this repo (audio-capture
//     uses node:child_process spawn — same pattern reused).
//   - sox `play` is already a hard dependency (capture path); zero new
//     install burden on the user.
//   - Streaming is the dominant case (`Phase 2 auto-TTS`, `Phase 4
//     /voice-chat`). Buffer-and-play would force the whole utterance to
//     synthesize before audio starts — defeats the streaming benefit.
//
// `playAudioFile` (afplay fallback) is the file-based short-clip path —
// for one-shot UI sounds where streaming has no benefit.

import { spawn, type ChildProcess } from 'node:child_process';
import { debug } from '../../debug/log.js';

// ── PCM format defaults ────────────────────────────────────────────

/** OpenAI TTS native PCM rate · ROADMAP §2.1 sox arg. */
export const DEFAULT_PCM_SAMPLE_RATE = 24000;
export const DEFAULT_PCM_CHANNELS = 1;
export const DEFAULT_PCM_BITS_PER_SAMPLE = 16;

// ── Public types ───────────────────────────────────────────────────

export interface AudioPlayerStartOpts {
  /** PCM sample rate (Hz). Default 24000 — matches OpenAI TTS native pcm. */
  sampleRate?: number;
  /** Channel count. Default 1 (mono). */
  channels?: number;
  /** Bit depth. Default 16. */
  bitsPerSample?: number;
}

export interface AudioPlayer {
  /** Spawn `play` reading raw PCM from stdin at the given format.
   *  Resolves to `true` on successful spawn; `false` if a player is
   *  already running, sox is missing, or the platform has no backend. */
  start(opts?: AudioPlayerStartOpts): Promise<boolean>;
  /** Append a PCM chunk to the playback stream. No-op + `false` when
   *  not started, after `drain()`/`stop()`, or on stdin write failure. */
  push(pcm: Buffer): boolean;
  /** Signal end-of-stream — close stdin and await subprocess exit. The
   *  player buffers any remaining PCM and exits when it finishes
   *  rendering. After resolve(), `start()` may be called again. */
  drain(): Promise<void>;
  /** SIGTERM the subprocess and await close — interrupts mid-utterance
   *  (ESC cancel path). After resolve(), `start()` may be called again. */
  stop(): Promise<void>;
  /** True between `start()` success and the close event. */
  isPlaying(): boolean;
}

export interface CreateAudioPlayerOpts {
  /** Inject a custom spawn for tests (CLAUDE.md prefers spyOn over
   *  mock.module — but the shipped helper accepts an injection seam too
   *  so individual tests can pass a fake without touching globals). */
  spawnFn?: typeof spawn;
}

// ── createAudioPlayer ──────────────────────────────────────────────

export function createAudioPlayer(opts: CreateAudioPlayerOpts = {}): AudioPlayer {
  const spawnFn = opts.spawnFn ?? spawn;
  let child: ChildProcess | null = null;
  let closePromise: Promise<void> | null = null;
  let closeResolve: (() => void) | null = null;

  function buildArgs(start: AudioPlayerStartOpts): string[] {
    return [
      '-q',
      '-t', 'raw',
      '-r', String(start.sampleRate ?? DEFAULT_PCM_SAMPLE_RATE),
      '-e', 'signed',
      '-b', String(start.bitsPerSample ?? DEFAULT_PCM_BITS_PER_SAMPLE),
      '-c', String(start.channels ?? DEFAULT_PCM_CHANNELS),
      '-', // stdin
    ];
  }

  async function start(startOpts: AudioPlayerStartOpts = {}): Promise<boolean> {
    if (child) {
      if (debug.enabled)
        debug.log('voice.playback', 'start.skip', {
          reason: 'already-playing', pid: child.pid,
        });
      return false;
    }
    if (process.platform === 'win32') {
      if (debug.enabled)
        debug.log('voice.playback', 'start.skip', { reason: 'win32-not-supported' });
      return false;
    }
    const args = buildArgs(startOpts);
    let proc: ChildProcess;
    try {
      proc = spawnFn('play', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.playback', 'spawn.error', { err: String(err) }, { level: 'error' });
      return false;
    }
    if (debug.enabled)
      debug.log('voice.playback', 'spawn', {
        pid: proc.pid,
        sampleRate: startOpts.sampleRate ?? DEFAULT_PCM_SAMPLE_RATE,
        channels: startOpts.channels ?? DEFAULT_PCM_CHANNELS,
        bitsPerSample: startOpts.bitsPerSample ?? DEFAULT_PCM_BITS_PER_SAMPLE,
      });
    child = proc;
    closePromise = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    // Drain stderr so sox-progress notes don't backpressure the subprocess.
    proc.stderr?.on('data', () => {});
    // Drain stdout (play is silent on stdout but defensive).
    proc.stdout?.on('data', () => {});
    proc.on('close', (code, signal) => {
      if (debug.enabled)
        debug.log('voice.playback', 'close', { pid: proc.pid, code, signal });
      if (child === proc) child = null;
      const r = closeResolve;
      closeResolve = null;
      closePromise = null;
      r?.();
    });
    proc.on('error', (err) => {
      if (debug.enabled)
        debug.log('voice.playback', 'error', { err: String(err) }, { level: 'error' });
    });
    return true;
  }

  function push(pcm: Buffer): boolean {
    if (!child || !child.stdin || child.stdin.destroyed) return false;
    try {
      child.stdin.write(pcm);
      return true;
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.playback', 'push.error', { err: String(err) }, { level: 'error' });
      return false;
    }
  }

  async function drain(): Promise<void> {
    if (!child) return;
    const stdin = child.stdin;
    const wait = closePromise ?? Promise.resolve();
    if (stdin && !stdin.destroyed) {
      await new Promise<void>((resolve) => {
        // stdin.end(callback) flushes pending writes + closes the pipe.
        // sox sees EOF, finishes rendering buffered audio, then exits.
        try {
          stdin.end(resolve);
        } catch (err) {
          if (debug.enabled)
            debug.log('voice.playback', 'drain.end-error', { err: String(err) }, { level: 'error' });
          resolve();
        }
      });
    }
    await wait;
  }

  async function stop(): Promise<void> {
    if (!child) return;
    const proc = child;
    const wait = closePromise ?? Promise.resolve();
    if (debug.enabled)
      debug.log('voice.playback', 'stop', { pid: proc.pid });
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.playback', 'kill.error', { err: String(err) }, { level: 'error' });
    }
    await wait;
  }

  function isPlaying(): boolean {
    return child !== null;
  }

  return { start, push, drain, stop, isPlaying };
}

// ── playAudioFile (file-based fallback) ────────────────────────────

export interface PlayAudioFileOpts {
  /** Path to any audio file the platform's player understands. */
  path: string;
}

/** Fire-and-forget short-clip playback. Tries `afplay` on macOS first
 *  (system-native, no sox dep), then falls back to sox `play` everywhere
 *  else. Resolves to `true` when the player exits cleanly. Used by Phase
 *  2 auto-TTS for one-shot notification sounds; the streaming path uses
 *  `createAudioPlayer` instead. */
export async function playAudioFile(
  opts: PlayAudioFileOpts,
  spawnFn: typeof spawn = spawn,
): Promise<boolean> {
  if (process.platform === 'darwin') {
    return await runAndAwait(spawnFn, 'afplay', [opts.path], 'afplay');
  }
  return await runAndAwait(spawnFn, 'play', ['-q', opts.path], 'play-file');
}

function runAndAwait(
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  tag: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn(cmd, args, { stdio: 'ignore' });
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.playback', `${tag}.spawn-error`, { err: String(err) }, { level: 'error' });
      resolve(false);
      return;
    }
    proc.on('close', (code) => {
      if (debug.enabled)
        debug.log('voice.playback', `${tag}.close`, { pid: proc.pid, code });
      resolve(code === 0);
    });
    proc.on('error', (err) => {
      if (debug.enabled)
        debug.log('voice.playback', `${tag}.error`, { err: String(err) }, { level: 'error' });
      resolve(false);
    });
  });
}
