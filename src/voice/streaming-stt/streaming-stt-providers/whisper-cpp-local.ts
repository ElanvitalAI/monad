// PR-S1V.8 (sprint 22 Phase 3 · 2026-04-29) — whisper.cpp local
// streaming STT.
//
// Wraps the `whisper-stream` CLI from ggerganov/whisper.cpp. Audio is
// piped to stdin, transcripts come back on stdout. The CLI does its
// own VAD-ish chunking — we forward each line we see as a partial,
// then a final emit on finalize().
//
// This provider intentionally minimal: monad doesn't bundle whisper.cpp
// — the user installs it. If the binary isn't on PATH, openSession
// throws `StreamingSTTProviderUnavailableError` so callers can fall
// back to cloud providers cleanly.
//
// Reference: ROADMAP §4.4 · github.com/ggerganov/whisper.cpp.

import { spawn, type ChildProcess } from 'node:child_process';
import { debug } from '../../../debug/log.js';
import {
  DEFAULT_STREAMING_STT_FORMAT,
  StreamingSTTProviderUnavailableError,
  type StreamingSTTOpts,
  type StreamingSTTPcmFormat,
  type StreamingSTTProvider,
  type StreamingSTTProviderId,
  type StreamingSTTSession,
  type WhisperCppLocalConfig,
} from '../streaming-stt-provider.js';

const DEFAULT_BINARY = 'whisper-stream';

export class WhisperCppLocalProvider implements StreamingSTTProvider {
  readonly id: StreamingSTTProviderId = 'whisper-cpp-local';
  readonly format: StreamingSTTPcmFormat = DEFAULT_STREAMING_STT_FORMAT;

  private readonly binaryPath: string;
  private readonly modelPath: string | undefined;

  constructor(cfg: WhisperCppLocalConfig) {
    this.binaryPath = cfg.binaryPath ?? process.env.WHISPER_CPP_BIN?.trim() ?? DEFAULT_BINARY;
    this.modelPath = cfg.modelPath ?? process.env.WHISPER_CPP_MODEL?.trim();
    if (!this.modelPath) {
      throw new StreamingSTTProviderUnavailableError(
        'whisper-cpp-local',
        'modelPath required — set WHISPER_CPP_MODEL env or cfg.modelPath to your GGUF file',
      );
    }
  }

  async openSession(opts: StreamingSTTOpts = {}): Promise<StreamingSTTSession> {
    // whisper-stream args:
    //   -m <model>      GGUF model path
    //   --step 500      window step (ms)
    //   --length 5000   total context (ms)
    //   -l <lang>       language hint (auto if missing)
    //   -t 4            threads
    //   --raw           read raw PCM 16k mono 16-bit from stdin
    const args: string[] = [
      '-m', this.modelPath!,
      '--step', '500',
      '--length', '5000',
      '-t', '4',
      '--raw',
    ];
    if (opts.language) args.push('-l', opts.language);

    let child: ChildProcess;
    try {
      child = spawn(this.binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      throw toUnavailableErr(err);
    }
    if (debug.enabled)
      debug.log('voice.stt.whisper', 'spawn', {
        pid: child.pid, binary: this.binaryPath, model: this.modelPath,
      });

    let closed = false;
    let lastPartial = '';
    let stdoutBuf = '';

    const closePromise = new Promise<void>((resolve) => {
      child.on('close', () => {
        closed = true;
        opts.onClose?.();
        resolve();
      });
    });

    child.on('error', (err) => {
      if (debug.enabled)
        debug.log('voice.stt.whisper', 'error', { err: String(err) }, { level: 'error' });
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      // whisper-stream emits one transcription line per window. Treat
      // the latest line as the partial.
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lastPartial = trimmed;
        opts.onPartial?.(trimmed);
      }
    });

    function pushAudio(pcm: Buffer): void {
      if (closed || !child.stdin || child.stdin.destroyed) return;
      try { child.stdin.write(pcm); }
      catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.whisper', 'push.error', { err: String(err) }, { level: 'error' });
      }
    }

    async function finalize(): Promise<void> {
      if (closed) return;
      // Closing stdin signals EOF — whisper-stream finalizes its window
      // and exits.
      try { child.stdin?.end(); } catch { /* ignore */ }
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
      await Promise.race([closePromise, timeout]);
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      await closePromise;
      if (lastPartial) opts.onFinal?.(lastPartial);
    }

    async function abort(): Promise<void> {
      if (closed) return;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      await closePromise;
    }

    function isOpen(): boolean { return !closed; }

    return { pushAudio, finalize, abort, isOpen };
  }
}

function toUnavailableErr(err: unknown): Error {
  const msg = String(err);
  if (msg.includes('ENOENT')) {
    return new StreamingSTTProviderUnavailableError(
      'whisper-cpp-local',
      'whisper-stream binary not on PATH — install whisper.cpp or set WHISPER_CPP_BIN',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
