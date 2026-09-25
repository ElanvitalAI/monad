// PR-S1V.1 (sprint 21-Parallel-Voice · 2026-04-29) — Audio capture
// subprocess routing + dependency probe tests.
//
// Tested invariants:
//   1. `hasCommand` returns true for known-present binaries and false
//      for known-absent ones (real spawnSync, not mocked).
//   2. `probeArecord` memoizes — repeat calls return the same promise.
//   3. `linuxHasAlsaCards` memoizes.
//   4. `isRunningOnWsl` is deterministic + cached.
//   5. `buildSoxInstallHint` returns a stable, recognizable string.
//   6. `detectPackageManager` returns null or a well-formed PackageManager
//      depending on the actual environment.
//   7. `checkRecordingAvailability` honors `MONAD_REMOTE` (no local mic)
//      and `process.platform === 'win32'` (not supported).
//   8. `stopRecording` is safe to call when no recorder is active.
//   9. `_getActiveRecorderForTesting` reflects internal state correctly.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  _resetActiveRecorderForTesting,
  _getActiveRecorderForTesting,
  checkRecordingAvailability,
  RECORDING_CHANNELS,
  RECORDING_SAMPLE_RATE,
  startWavInjectionRecording,
  stopRecording,
} from '../src/voice/audio-capture.js';
import {
  _resetAllProbesForTesting,
  buildSoxInstallHint,
  detectPackageManager,
  hasCommand,
  isRunningOnWsl,
  linuxHasAlsaCards,
  probeArecord,
} from '../src/voice/audio-deps-probe.js';

// ── env helpers ─────────────────────────────────────────────────────

/** Await a callback-completion promise with a bound.
 *
 *  ⚠️ Replacing a fixed sleep with `await ended` removes the wasted wait but
 *  reintroduces the worse failure: if a regression stops `onEnd` from firing,
 *  an unbounded await hangs this file forever, and one hanging file keeps the
 *  whole `bun test` run from exiting. That reads as "the suite is slow"
 *  instead of "onEnd regressed". Rejecting on the bound turns the regression
 *  back into a test failure, which is the point. */
async function awaitBounded(p: Promise<void>, ms: number, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not fire within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ENV_KEYS = ['MONAD_REMOTE'] as const;
const savedEnv: Record<string, string | undefined> = {};

function captureEnv(): void {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

// ── shared setup ────────────────────────────────────────────────────

beforeEach(() => {
  captureEnv();
  _resetAllProbesForTesting();
  _resetActiveRecorderForTesting();
});

afterEach(() => {
  restoreEnv();
  _resetAllProbesForTesting();
  _resetActiveRecorderForTesting();
});

// ── constants ───────────────────────────────────────────────────────

describe('PR-S1V.1 · audio constants', () => {
  test('PCM format matches subprocess args (24 kHz mono)', () => {
    // 2026-04-30: bumped 16k → 24k to satisfy OpenAI realtime's
    // >= 24kHz minimum. Other STT providers either accept 24k or sox
    // downsamples on their behalf.
    expect(RECORDING_SAMPLE_RATE).toBe(24000);
    expect(RECORDING_CHANNELS).toBe(1);
  });
});

// ── hasCommand ──────────────────────────────────────────────────────

describe('PR-S1V.1 · hasCommand', () => {
  test('returns true for a known-present binary (node)', () => {
    // `node` is required to run `bun test` — guaranteed to exist in PATH.
    // We don't actually need node specifically; any always-present cmd
    // works. spawnSync('node --version') is fast and side-effect-free.
    expect(hasCommand('node')).toBe(true);
  });

  test('returns false for a binary that cannot exist', () => {
    expect(hasCommand('monad-voice-test-cmd-that-does-not-exist-89412')).toBe(false);
  });
});

// ── isRunningOnWsl ──────────────────────────────────────────────────

describe('PR-S1V.1 · isRunningOnWsl', () => {
  test('returns false on non-linux platforms (darwin in CI)', () => {
    if (process.platform !== 'linux') {
      expect(isRunningOnWsl()).toBe(false);
    } else {
      // Linux: result depends on whether /proc/sys/kernel/osrelease
      // contains "microsoft" or "wsl". Either way the value is a boolean.
      expect(typeof isRunningOnWsl()).toBe('boolean');
    }
  });

  test('result is cached — same value on repeat calls', () => {
    const first = isRunningOnWsl();
    const second = isRunningOnWsl();
    expect(first).toBe(second);
  });
});

// ── buildSoxInstallHint ─────────────────────────────────────────────

describe('PR-S1V.1 · buildSoxInstallHint', () => {
  test('mentions sox by name', () => {
    const hint = buildSoxInstallHint();
    expect(hint.toLowerCase()).toContain('sox');
  });

  test('returns a non-empty string', () => {
    expect(buildSoxInstallHint().trim().length).toBeGreaterThan(0);
  });
});

// ── detectPackageManager ────────────────────────────────────────────

describe('PR-S1V.1 · detectPackageManager', () => {
  test('returns null or a well-formed PackageManagerInfo', () => {
    const pm = detectPackageManager();
    if (pm === null) return;
    expect(typeof pm.cmd).toBe('string');
    expect(Array.isArray(pm.args)).toBe(true);
    expect(pm.args.length).toBeGreaterThan(0);
    expect(typeof pm.displayCommand).toBe('string');
    expect(pm.displayCommand).toContain('sox');
  });

  test('display command on darwin (when brew exists) starts with brew', () => {
    if (process.platform !== 'darwin') return;
    const pm = detectPackageManager();
    if (pm === null) return; // brew not installed — skip
    expect(pm.cmd).toBe('brew');
    expect(pm.displayCommand).toBe('brew install sox');
  });
});

// ── probeArecord (memoization only — actual probe is linux-only) ────

describe('PR-S1V.1 · probeArecord', () => {
  test('returns the same promise on repeat calls (memoized)', () => {
    const p1 = probeArecord();
    const p2 = probeArecord();
    expect(p1).toBe(p2);
  });

  test('result shape is { ok, stderr }', async () => {
    const result = await probeArecord();
    expect(typeof result.ok).toBe('boolean');
    expect(typeof result.stderr).toBe('string');
  });
});

// ── linuxHasAlsaCards (memoization) ─────────────────────────────────

describe('PR-S1V.1 · linuxHasAlsaCards', () => {
  test('returns the same promise on repeat calls (memoized)', () => {
    const p1 = linuxHasAlsaCards();
    const p2 = linuxHasAlsaCards();
    expect(p1).toBe(p2);
  });

  test('returns false on non-linux (no /proc/asound/cards)', async () => {
    if (process.platform === 'linux') return; // skip — actual linux probe
    expect(await linuxHasAlsaCards()).toBe(false);
  });
});

// ── checkRecordingAvailability ──────────────────────────────────────

describe('PR-S1V.1 · checkRecordingAvailability', () => {
  test('MONAD_REMOTE → unavailable with dual-attach hint', async () => {
    process.env.MONAD_REMOTE = 'mbp.tailnet:31415';
    const result = await checkRecordingAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Remote attach');
    expect(result.reason?.toLowerCase()).toContain('dual-attach');
  });

  test('without MONAD_REMOTE — depends on environment, but reason-when-unavailable is non-empty', async () => {
    delete process.env.MONAD_REMOTE;
    const result = await checkRecordingAvailability();
    if (result.available) {
      expect(result.reason).toBe(null);
    } else {
      expect(result.reason).not.toBe(null);
      expect((result.reason ?? '').trim().length).toBeGreaterThan(0);
    }
  });
});

// ── stopRecording ───────────────────────────────────────────────────

describe('PR-S1V.1 · stopRecording', () => {
  test('safe to call when no recorder is active (no throw)', () => {
    _resetActiveRecorderForTesting();
    expect(_getActiveRecorderForTesting()).toBe(null);
    expect(() => stopRecording()).not.toThrow();
    expect(_getActiveRecorderForTesting()).toBe(null);
  });
});

// ── startWavInjectionRecording (`VOICE_DEBUG_INPUT_WAV` seam) ───────
//
// Used for SSH/remote dogfood (no usable mic on the host) and STT
// model A/B comparison (same input WAV, different models). SoX itself
// transcodes the input; the test verifies the spawn succeeds, PCM
// flows through `onData`, and `onEnd` fires when sox exits.

describe('PR-S1V · startWavInjectionRecording', () => {
  beforeEach(() => {
    _resetActiveRecorderForTesting();
  });
  afterEach(() => {
    _resetActiveRecorderForTesting();
  });

  test('returns false when target file does not exist (sox spawns but exits non-zero)', async () => {
    if (!hasCommand('sox')) return; // skip on hosts without sox
    const onData = (_chunk: Buffer): void => { /* no-op */ };
    let endFired = false;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
    const onEnd = (): void => {
      endFired = true;
      resolveEnd();
    };
    const ok = startWavInjectionRecording(
      '/tmp/monad-voice-test-does-not-exist.wav',
      onData,
      onEnd,
    );
    // spawn itself succeeds — sox starts, then errors on missing file.
    // The seam reports `true` for spawn-ok; downstream observes the
    // empty PCM + onEnd callback for the failure case.
    expect(ok).toBe(true);
    await awaitBounded(ended, 10_000, 'sox onEnd');
    expect(endFired).toBe(true);
  });

  test('streams PCM chunks and fires onEnd for a real WAV', async () => {
    if (!hasCommand('sox')) return;
    // Build a 0.5 sec WAV via sox's synth so we don't depend on a fixture.
    const tmpWav = `/tmp/monad-voice-test-${Date.now()}.wav`;
    const { spawnSync } = await import('node:child_process');
    spawnSync('sox', [
      '-n', tmpWav,
      'synth', '0.5', 'sine', '440',
      'rate', '16000', 'channels', '1',
    ]);

    const chunks: Buffer[] = [];
    let endFired = false;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
    const ok = startWavInjectionRecording(
      tmpWav,
      (chunk) => chunks.push(chunk),
      () => {
        endFired = true;
        resolveEnd();
      },
    );
    expect(ok).toBe(true);
    await awaitBounded(ended, 10_000, 'sox onEnd');
    expect(endFired).toBe(true);
    const totalBytes = chunks.reduce((acc, b) => acc + b.byteLength, 0);
    // 0.5 sec @ 24 kHz mono 16-bit = 24000 bytes; allow ±10 % for
    // sox priming/EOF jitter.
    expect(totalBytes).toBeGreaterThan(21000);
    expect(totalBytes).toBeLessThan(28000);

    // Cleanup.
    const fs = await import('node:fs/promises');
    await fs.unlink(tmpWav).catch(() => { /* best-effort */ });
  });
});
