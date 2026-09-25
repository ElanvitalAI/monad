// PR-S1V.1 (sprint 21-Parallel-Voice · 2026-04-29) — Audio capture
// dependency probes.
//
// `audio-capture.ts` 의 subprocess fallback chain (sox/arecord) 의
// pre-flight. 각 backend 가 실제 device 를 open 할 수 있는지 / 어떤
// platform 에서 어떤 backend 를 쓸 수 있는지 결정.
//
// 차용 ref (RESEARCH §5.2 / §7.1 + claude-code-fork voice.ts):
//   - hasCommand: `voice.ts:49-61` — `spawnSync('cmd', ['--version'])`
//     + ENOENT/EACCES check. Termux/Android 의 `which` builtin 우회.
//   - probeArecord: `voice.ts:75-118` — 150ms timer race · WSL1/Win10
//     headless detection.
//   - linuxHasAlsaCards: `voice.ts:130-143` — `/proc/asound/cards` read.
//   - detectPackageManager: `voice.ts:151-188` — brew/apt-get/dnf/pacman.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { debug } from '../debug/log.js';

// ── Shared constants ────────────────────────────────────────────────

// 2026-04-30 (experiment/voice-chat-realtime-rebind):
// Bumped 16000 → 24000 to satisfy OpenAI realtime API's >= 24kHz
// minimum. sox handles the downsample for providers that prefer 16k
// (gemini-live, whisper-cpp). Higher capture rate also marginally
// improves Whisper / gpt-4o-transcribe accuracy on consonant-heavy
// languages (e.g., Korean).
export const RECORDING_SAMPLE_RATE = 24000;
export const RECORDING_CHANNELS = 1;

// ── hasCommand ─────────────────────────────────────────────────────

/**
 * Whether `cmd` is invokable. Spawns the target directly with `--version`
 * instead of `which` because some envs (Termux/Android) make `which` a
 * shell builtin while the binary itself is absent or kernel-blocked.
 *
 * `result.error` is set iff spawn itself fails (ENOENT/EACCES). Exit code
 * is irrelevant — an unrecognized `--version` flag still implies the
 * binary exists.
 */
export function hasCommand(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], {
    stdio: 'ignore',
    timeout: 3000,
  });
  return result.error === undefined;
}

// ── probeArecord ────────────────────────────────────────────────────

export type ArecordProbeResult = { ok: boolean; stderr: string };

let arecordProbe: Promise<ArecordProbeResult> | null = null;

/**
 * Whether arecord can actually open a capture device. `hasCommand` only
 * checks PATH — on WSL1/Win10-WSL2/headless Linux the binary exists but
 * `open()` fails because there is no ALSA card and no PulseAudio server.
 * On WSL2+WSLg (Win11 default) PulseAudio works via RDP pipes and arecord
 * succeeds.
 *
 * Race a 150ms timer: if the process is still alive after the timer it
 * opened the device (treat as ok); if it exits early the stderr tells us
 * why. Memoized — device availability does not change mid-session.
 */
export function probeArecord(): Promise<ArecordProbeResult> {
  arecordProbe ??= new Promise(resolve => {
    if (debug.enabled) debug.log('voice.probe', 'arecord.start', { sampleRate: RECORDING_SAMPLE_RATE });
    const child = spawn(
      'arecord',
      [
        '-f',
        'S16_LE',
        '-r',
        String(RECORDING_SAMPLE_RATE),
        '-c',
        String(RECORDING_CHANNELS),
        '-t',
        'raw',
        '/dev/null',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(
      (c: ChildProcess) => {
        c.kill('SIGTERM');
        if (debug.enabled) debug.log('voice.probe', 'arecord.timeout', { ok: true }, { level: 'warn' });
        resolve({ ok: true, stderr: '' });
      },
      150,
      child,
    );
    child.once('close', code => {
      clearTimeout(timer);
      // SIGTERM close (code=null) after timer fired is already resolved.
      // Early close with code=0 is unusual (arecord shouldn't exit on its
      // own) but treat as ok.
      const result = { ok: code === 0, stderr: stderr.trim() };
      if (debug.enabled) debug.log('voice.probe', 'arecord.close', { code, ok: result.ok });
      resolve(result);
    });
    child.once('error', () => {
      clearTimeout(timer);
      if (debug.enabled) debug.log('voice.probe', 'arecord.error', { stderr: 'arecord: command not found' }, { level: 'error' });
      resolve({ ok: false, stderr: 'arecord: command not found' });
    });
  });
  return arecordProbe;
}

export function _resetArecordProbeForTesting(): void {
  arecordProbe = null;
}

// ── linuxHasAlsaCards ───────────────────────────────────────────────

let linuxAlsaCardsMemo: Promise<boolean> | null = null;

/**
 * Whether `/proc/asound/cards` reports at least one sound card. On
 * headless Linux / WSL1 this is empty or "no soundcards", which means
 * audio backends will fail at open() time. Memoized.
 */
export function linuxHasAlsaCards(): Promise<boolean> {
  linuxAlsaCardsMemo ??= readFile('/proc/asound/cards', 'utf8').then(
    cards => {
      const c = cards.trim();
      const has = c !== '' && !c.includes('no soundcards');
      if (debug.enabled) debug.log('voice.probe', 'alsa-cards', { has });
      return has;
    },
    () => {
      if (debug.enabled) debug.log('voice.probe', 'alsa-cards', { has: false, err: 'read-fail' });
      return false;
    },
  );
  return linuxAlsaCardsMemo;
}

export function _resetAlsaCardsForTesting(): void {
  linuxAlsaCardsMemo = null;
}

// ── isRunningOnWsl ──────────────────────────────────────────────────

let wslMemo: boolean | null = null;

/**
 * Heuristic WSL detection. `/proc/sys/kernel/osrelease` includes
 * "microsoft" or "WSL" on both WSL1 and WSL2. Result is sync-cached
 * because it is invariant for the process lifetime.
 */
export function isRunningOnWsl(): boolean {
  if (wslMemo !== null) return wslMemo;
  if (process.platform !== 'linux') {
    wslMemo = false;
    return wslMemo;
  }
  try {
    const { readFileSync } = require('node:fs');
    const release = String(readFileSync('/proc/sys/kernel/osrelease', 'utf8')).toLowerCase();
    wslMemo = release.includes('microsoft') || release.includes('wsl');
  } catch {
    wslMemo = false;
  }
  return wslMemo;
}

export function _resetWslMemoForTesting(): void {
  wslMemo = null;
}

// ── detectPackageManager ────────────────────────────────────────────

export type PackageManagerInfo = {
  cmd: string;
  args: string[];
  displayCommand: string;
};

/**
 * Best-effort detection of the platform package manager + a ready-to-run
 * `install sox` invocation. Returns `null` when no recognised manager is
 * present so callers can show a generic install hint.
 */
export function detectPackageManager(): PackageManagerInfo | null {
  if (process.platform === 'darwin') {
    if (hasCommand('brew')) {
      return {
        cmd: 'brew',
        args: ['install', 'sox'],
        displayCommand: 'brew install sox',
      };
    }
    return null;
  }

  if (process.platform === 'linux') {
    if (hasCommand('apt-get')) {
      return {
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'sox'],
        displayCommand: 'sudo apt-get install sox',
      };
    }
    if (hasCommand('dnf')) {
      return {
        cmd: 'sudo',
        args: ['dnf', 'install', '-y', 'sox'],
        displayCommand: 'sudo dnf install sox',
      };
    }
    if (hasCommand('pacman')) {
      return {
        cmd: 'sudo',
        args: ['pacman', '-S', '--noconfirm', 'sox'],
        displayCommand: 'sudo pacman -S sox',
      };
    }
  }

  return null;
}

// ── Install hint message ────────────────────────────────────────────

export function buildSoxInstallHint(): string {
  const pm = detectPackageManager();
  if (pm) {
    return `Voice mode requires SoX for audio recording. Install it with: ${pm.displayCommand}`;
  }
  return [
    'Voice mode requires SoX for audio recording. Install SoX manually:',
    '  macOS:        brew install sox',
    '  Ubuntu/Debian: sudo apt-get install sox',
    '  Fedora:       sudo dnf install sox',
    '  Arch:         sudo pacman -S sox',
  ].join('\n');
}

// ── Test helpers ────────────────────────────────────────────────────

export function _resetAllProbesForTesting(): void {
  _resetArecordProbeForTesting();
  _resetAlsaCardsForTesting();
  _resetWslMemoForTesting();
}
