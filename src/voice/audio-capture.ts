// PR-S1V.1 (sprint 21-Parallel-Voice · 2026-04-29) — Subprocess audio
// capture for push-to-talk voice input.
//
// Routes the recording call through a platform-aware fallback chain:
//   - Linux: arecord (ALSA) when probe succeeds, else SoX `rec`.
//   - macOS: SoX `rec` (single backend — arecord is Linux-only).
//   - WSL2+WSLg: same as Linux (PulseAudio bridge handles arecord/sox).
//   - Windows / WSL1 / headless Linux: not supported (no fallback).
//
// 본 모듈은 capture **layer 만** 담당. STT (cloud Whisper / ElevenLabs
// Scribe / streaming) 은 PR-S1V.2 의 `STTProvider` interface 가 본 모듈의
// PCM Buffer chunk 를 consume.
//
// 차용 ref (RESEARCH §5.2 / §7.1 + claude-code-fork voice.ts):
//   - checkRecordingAvailability: `voice.ts:259-328` (native 분기 제거 후 차용)
//   - startRecording fallback chain: `voice.ts:335-396`
//   - startSoxRecording: `voice.ts:398-466` — `--buffer 1024` flush
//   - startArecordRecording: `voice.ts:468-513` — `S16_LE` raw PCM
//   - stopRecording: `voice.ts:515-525` (subprocess SIGTERM 만 차용)

import { spawn, type ChildProcess } from 'node:child_process';
import { debug } from '../debug/log.js';
import {
  RECORDING_SAMPLE_RATE,
  RECORDING_CHANNELS,
  hasCommand,
  probeArecord,
  isRunningOnWsl,
  buildSoxInstallHint,
} from './audio-deps-probe.js';

// ── SoX silence detection constants ─────────────────────────────────

// SoX `silence` filter parameters: stop after this duration of silence
// below the threshold. Matches claude-code-fork constants for consistent
// UX across the two tools.
const SILENCE_DURATION_SECS = '2.0';
const SILENCE_THRESHOLD = '3%';

// ── Public types ────────────────────────────────────────────────────

export type RecordingAvailability = {
  available: boolean;
  reason: string | null;
};

export type StartRecordingOptions = {
  /** When false, run in push-to-talk mode (no auto-stop). Default true. */
  silenceDetection?: boolean;
};

// Re-export so callers don't need to know the dependency module split.
export { RECORDING_SAMPLE_RATE, RECORDING_CHANNELS };

// ── Recorder state ──────────────────────────────────────────────────

let activeRecorder: ChildProcess | null = null;

// ── checkRecordingAvailability ──────────────────────────────────────

/**
 * Whether at least one capture backend can succeed in the current
 * environment. Walks the same fallback chain as `startRecording` so the
 * UX gating decision matches the actual recording behavior.
 */
export async function checkRecordingAvailability(): Promise<RecordingAvailability> {
  // Remote attach has no local microphone — point users at the
  // dual-attach pattern (UX matrix §6).
  if (process.env.ELANOUS_REMOTE) {
    return {
      available: false,
      reason:
        'Voice mode requires microphone access. Remote attach (ELANOUS_REMOTE) has no local audio device — use the dual-attach pattern (SSH-TUI text + PWA voice on the same device).',
    };
  }

  if (process.platform === 'win32') {
    return {
      available: false,
      reason:
        'Voice mode is not yet supported on Windows. Use WSL2+WSLg with sox installed, or a macOS/Linux machine.',
    };
  }

  const wslNoAudioReason =
    'Voice mode could not access an audio device in WSL.\nWSL2 with WSLg (Windows 11) provides audio via PulseAudio — if you are on Windows 10 or WSL1, run elanous on native macOS/Linux instead.';

  // On Linux (incl. WSL), probe arecord first. hasCommand() is not
  // sufficient: the binary can exist while open() fails (WSL1 / Win10-
  // WSL2 / headless Linux). WSL2+WSLg is the case where arecord
  // succeeds via PulseAudio RDP pipes.
  if (process.platform === 'linux' && hasCommand('arecord')) {
    const probe = await probeArecord();
    if (probe.ok) {
      return { available: true, reason: null };
    }
    if (isRunningOnWsl()) {
      return { available: false, reason: wslNoAudioReason };
    }
    if (debug.enabled)
      debug.log('voice.availability', 'arecord-probe-failed', { stderr: probe.stderr }, { level: 'error' });
    // fall through to SoX
  }

  // Fallback: SoX `rec`
  if (!hasCommand('rec')) {
    if (process.platform === 'linux' && isRunningOnWsl()) {
      return { available: false, reason: wslNoAudioReason };
    }
    return { available: false, reason: buildSoxInstallHint() };
  }

  return { available: true, reason: null };
}

// ── requestMicrophonePermission ─────────────────────────────────────

/**
 * Probe-record through the full fallback chain to verify at least one
 * backend actually works. On macOS this triggers the TCC permission
 * dialog on first use (more reliable than querying `tccutil`).
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  const started = await startRecording(
    () => {}, // discard audio — permission probe only
    () => {},
    { silenceDetection: false },
  );
  if (!started) return false;
  stopRecording();
  return true;
}

// ── startRecording ──────────────────────────────────────────────────

/**
 * Start capturing 16 kHz · 16-bit signed · mono raw PCM to `onData` and
 * fire `onEnd` when the recorder exits. Returns `true` if a backend
 * spawned successfully.
 *
 * Fallback chain matches `checkRecordingAvailability`:
 *   linux + arecord-probe-ok → arecord
 *   else → SoX `rec` (macOS or Linux fallback)
 */
export async function startRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
  options?: StartRecordingOptions,
): Promise<boolean> {
  const useSilenceDetection = options?.silenceDetection !== false;
  if (debug.enabled)
    debug.log('voice.capture', 'start', {
      platform: process.platform,
      silenceDetection: useSilenceDetection,
    });

  // WAV file injection seam — when `VOICE_DEBUG_INPUT_WAV` points at an
  // audio file, bypass the live mic and stream that file's PCM through
  // the same downstream pipeline (PCM accumulator → wrapPcmInWav →
  // STT). Designed for two recurring scenarios:
  //
  //   1. SSH/remote dogfood — host running elanous has no usable mic
  //      (developer is on a different machine via SSH). Inject a
  //      pre-recorded WAV to exercise the toggle/STT/transcript pipe
  //      end-to-end without needing audio routing.
  //   2. STT model A/B comparison — feed the same input WAV through
  //      different `OPENAI_STT_MODEL` values to compare accuracy +
  //      hallucination rate on identical audio.
  //
  // SoX handles format conversion (any sample rate / bit depth → 16 kHz
  // 16-bit signed mono raw), so the input WAV format is flexible.
  // Recording lifecycle (start/stop, sox.close on EOF) is identical to
  // live mic capture, so the rest of the pipeline doesn't see this
  // path differently. To use:
  //   `VOICE_DEBUG_INPUT_WAV=/path/to/sample.wav bun run dev`
  const debugInputWav = process.env.VOICE_DEBUG_INPUT_WAV?.trim();
  if (debugInputWav) {
    return startWavInjectionRecording(debugInputWav, onData, onEnd);
  }

  if (process.platform === 'win32') {
    if (debug.enabled)
      debug.log('voice.capture', 'start.skip', { reason: 'win32-not-supported' });
    return false;
  }

  if (
    process.platform === 'linux' &&
    hasCommand('arecord') &&
    (await probeArecord()).ok
  ) {
    return startArecordRecording(onData, onEnd);
  }

  return startSoxRecording(onData, onEnd, options);
}

// ── Internal: WAV file injection (`VOICE_DEBUG_INPUT_WAV`) ──────────

/** Read `wavPath` through `sox` (any format → raw 16 kHz · 16-bit
 *  signed mono PCM) and stream the bytes through `onData` exactly as
 *  the live mic path does. `onEnd` fires when sox finishes the file
 *  (or errors). Returns `true` if sox spawned successfully.
 *
 *  Used by `VOICE_DEBUG_INPUT_WAV` env switch — see startRecording. */
export function startWavInjectionRecording(
  wavPath: string,
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
): boolean {
  // SoX as transcoder: read <wavPath>, output raw 16 kHz · 16-bit
  // signed mono PCM to stdout. Output shape matches `rec`, so the
  // downstream PCM accumulator doesn't need to branch on source.
  const args: string[] = [
    '-q',
    wavPath,
    '-t', 'raw',
    '-r', String(RECORDING_SAMPLE_RATE),
    '-e', 'signed',
    '-b', '16',
    '-c', String(RECORDING_CHANNELS),
    '-',
  ];

  let child: ChildProcess;
  try {
    child = spawn('sox', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (debug.enabled)
      debug.log('voice.capture', 'wav-inject.spawn-error', {
        err: String(err), wavPath,
      }, { level: 'error' });
    return false;
  }

  activeRecorder = child;
  if (debug.enabled)
    debug.log('voice.capture', 'wav-inject.spawned', {
      pid: child.pid,
      wavPath,
    });

  child.stdout?.on('data', (chunk: Buffer) => onData(chunk));

  let stderrBuf = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  child.on('close', (code) => {
    if (debug.enabled)
      debug.log('voice.capture', 'wav-inject.close', {
        pid: child.pid,
        code,
        stderr: stderrBuf.slice(0, 200),
      });
    if (activeRecorder === child) activeRecorder = null;
    onEnd();
  });

  return true;
}

// ── stopRecording ───────────────────────────────────────────────────

export function stopRecording(): void {
  if (!activeRecorder) return;
  if (debug.enabled)
    debug.log('voice.capture', 'stop', { pid: activeRecorder.pid });
  activeRecorder.kill('SIGTERM');
  activeRecorder = null;
}

// ── Internal: SoX `rec` ─────────────────────────────────────────────

function startSoxRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
  options?: StartRecordingOptions,
): boolean {
  const useSilenceDetection = options?.silenceDetection !== false;

  // Raw PCM: 16 kHz · 16-bit signed · mono · stdout.
  // --buffer 1024 forces SoX to flush in small chunks instead of
  // accumulating several seconds before stdout sees anything.
  const args: string[] = [
    '-q', // quiet
    '--buffer',
    '1024',
    '-t',
    'raw',
    '-r',
    String(RECORDING_SAMPLE_RATE),
    '-e',
    'signed',
    '-b',
    '16',
    '-c',
    String(RECORDING_CHANNELS),
    '-', // stdout
  ];

  // SoX silence filter — auto-stop on silence. Omit for push-to-talk
  // where the caller controls start/stop directly.
  if (useSilenceDetection) {
    args.push(
      'silence',
      '1',
      '0.1',
      SILENCE_THRESHOLD,
      '1',
      SILENCE_DURATION_SECS,
      SILENCE_THRESHOLD,
    );
  }

  let child: ChildProcess;
  try {
    child = spawn('rec', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    if (debug.enabled)
      debug.log('voice.capture', 'sox.spawn-error', { err: String(err) }, { level: 'error' });
    return false;
  }

  activeRecorder = child;
  if (debug.enabled)
    debug.log('voice.capture', 'sox.spawned', {
      pid: child.pid,
      silenceDetection: useSilenceDetection,
    });

  child.stdout?.on('data', (chunk: Buffer) => onData(chunk));

  // Drain stderr to prevent backpressure on the subprocess pipe.
  child.stderr?.on('data', () => {});

  child.on('close', () => {
    if (debug.enabled) debug.log('voice.capture', 'sox.close', { pid: child.pid });
    if (activeRecorder === child) activeRecorder = null;
    onEnd();
  });

  child.on('error', err => {
    if (debug.enabled)
      debug.log('voice.capture', 'sox.error', { err: String(err) }, { level: 'error' });
    if (activeRecorder === child) activeRecorder = null;
    onEnd();
  });

  return true;
}

// ── Internal: arecord (Linux ALSA) ──────────────────────────────────

function startArecordRecording(
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
): boolean {
  // Raw PCM: 16 kHz · 16-bit signed little-endian · mono · stdout.
  // arecord has no built-in silence detection — push-to-talk only.
  const args = [
    '-f',
    'S16_LE',
    '-r',
    String(RECORDING_SAMPLE_RATE),
    '-c',
    String(RECORDING_CHANNELS),
    '-t',
    'raw',
    '-q',
    '-',
  ];

  let child: ChildProcess;
  try {
    child = spawn('arecord', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    if (debug.enabled)
      debug.log('voice.capture', 'arecord.spawn-error', { err: String(err) }, { level: 'error' });
    return false;
  }

  activeRecorder = child;
  if (debug.enabled)
    debug.log('voice.capture', 'arecord.spawned', { pid: child.pid });

  child.stdout?.on('data', (chunk: Buffer) => onData(chunk));
  child.stderr?.on('data', () => {});

  child.on('close', () => {
    if (debug.enabled)
      debug.log('voice.capture', 'arecord.close', { pid: child.pid });
    if (activeRecorder === child) activeRecorder = null;
    onEnd();
  });

  child.on('error', err => {
    if (debug.enabled)
      debug.log('voice.capture', 'arecord.error', { err: String(err) }, { level: 'error' });
    if (activeRecorder === child) activeRecorder = null;
    onEnd();
  });

  return true;
}

// ── Test helpers ────────────────────────────────────────────────────

export function _getActiveRecorderForTesting(): ChildProcess | null {
  return activeRecorder;
}

export function _resetActiveRecorderForTesting(): void {
  activeRecorder = null;
}
