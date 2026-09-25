// PR-S1V.10 (sprint 22 Phase 5) — local energy VAD detector.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createVadDetector,
  readVadOptsFromEnv,
  resolveVadModeFromEnv,
} from '../src/voice/streaming-stt/streaming-stt-vad.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

// ── Helpers ────────────────────────────────────────────────────────

function makePcmFrame(durationMs: number, amplitude: number, sampleRate = 16000): Buffer {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    // Sine-like waveform — amplitude in [0, 1] of int16 max.
    const v = Math.round(amplitude * 32767 * Math.sin((i / samples) * Math.PI * 2 * 50));
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

function silenceFrame(durationMs: number, sampleRate = 16000): Buffer {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  return Buffer.alloc(samples * 2);
}

// ── createVadDetector ──────────────────────────────────────────────

describe('createVadDetector — speech detection', () => {
  it('fires onSpeechStart after minSpeechMs of active audio', () => {
    let started = 0;
    let ended = 0;
    const vad = createVadDetector({
      threshold: 0.05,
      minSpeechMs: 100,
      silenceMs: 200,
      onSpeechStart: () => { started += 1; },
      onSpeechEnd: () => { ended += 1; },
    });
    // Push 200ms of speech-level audio
    vad.push(makePcmFrame(200, 0.3));
    expect(started).toBe(1);
    expect(ended).toBe(0);
    expect(vad.isInSpeech()).toBe(true);
  });

  it('does not fire onSpeechStart for short bursts under minSpeechMs', () => {
    let started = 0;
    const vad = createVadDetector({
      threshold: 0.05,
      minSpeechMs: 200,
      silenceMs: 200,
      onSpeechStart: () => { started += 1; },
    });
    // Only 100ms of speech — under threshold
    vad.push(makePcmFrame(100, 0.3));
    vad.push(silenceFrame(50));
    expect(started).toBe(0);
  });

  it('fires onSpeechEnd after silenceMs of below-threshold audio', () => {
    let started = 0;
    let ended = 0;
    const vad = createVadDetector({
      threshold: 0.05,
      minSpeechMs: 100,
      silenceMs: 200,
      onSpeechStart: () => { started += 1; },
      onSpeechEnd: () => { ended += 1; },
    });
    vad.push(makePcmFrame(200, 0.3));
    expect(started).toBe(1);
    vad.push(silenceFrame(300));
    expect(ended).toBe(1);
    expect(vad.isInSpeech()).toBe(false);
  });

  it('handles split-frame chunks via internal carry buffer', () => {
    let started = 0;
    const vad = createVadDetector({
      threshold: 0.05,
      minSpeechMs: 100,
      onSpeechStart: () => { started += 1; },
    });
    const full = makePcmFrame(150, 0.3);
    // Split at an odd byte (mid-sample) to exercise the carry buffer
    vad.push(full.subarray(0, 41));
    vad.push(full.subarray(41, 187));
    vad.push(full.subarray(187));
    // Should still detect speech start
    expect(started).toBe(1);
  });

  it('lastRms reflects latest computation', () => {
    const vad = createVadDetector({ threshold: 0.05 });
    vad.push(silenceFrame(60));
    expect(vad.lastRms()).toBeLessThan(0.01);
    vad.push(makePcmFrame(60, 0.5));
    expect(vad.lastRms()).toBeGreaterThan(0.05);
  });
});

describe('createVadDetector — reset', () => {
  it('reset() drops in-speech and fires onSpeechEnd', () => {
    let ended = 0;
    const vad = createVadDetector({
      threshold: 0.05,
      minSpeechMs: 50,
      onSpeechEnd: () => { ended += 1; },
    });
    vad.push(makePcmFrame(150, 0.3));
    expect(vad.isInSpeech()).toBe(true);
    vad.reset();
    expect(vad.isInSpeech()).toBe(false);
    expect(ended).toBe(1);
  });

  it('reset() while idle does not fire onSpeechEnd', () => {
    let ended = 0;
    const vad = createVadDetector({ onSpeechEnd: () => { ended += 1; } });
    vad.reset();
    expect(ended).toBe(0);
  });
});

describe('resolveVadModeFromEnv', () => {
  it('returns fallback when MONAD_VOICE_VAD unset', () => {
    delete process.env.MONAD_VOICE_VAD;
    expect(resolveVadModeFromEnv()).toBe('server');
    expect(resolveVadModeFromEnv('local')).toBe('local');
  });

  it('returns env value when valid', () => {
    process.env.MONAD_VOICE_VAD = 'local';
    expect(resolveVadModeFromEnv()).toBe('local');
    process.env.MONAD_VOICE_VAD = 'manual';
    expect(resolveVadModeFromEnv()).toBe('manual');
    process.env.MONAD_VOICE_VAD = 'server';
    expect(resolveVadModeFromEnv()).toBe('server');
  });

  it('falls back when env value unknown', () => {
    process.env.MONAD_VOICE_VAD = 'gibberish';
    expect(resolveVadModeFromEnv()).toBe('server');
  });
});

describe('readVadOptsFromEnv', () => {
  it('returns base when no env vars set', () => {
    delete process.env.MONAD_VOICE_VAD_THRESHOLD;
    delete process.env.MONAD_VOICE_VAD_SILENCE_MS;
    delete process.env.MONAD_VOICE_VAD_MIN_SPEECH_MS;
    expect(readVadOptsFromEnv({ threshold: 0.5 })).toEqual({ threshold: 0.5 });
  });

  it('reads numeric env overrides', () => {
    process.env.MONAD_VOICE_VAD_THRESHOLD = '0.025';
    process.env.MONAD_VOICE_VAD_SILENCE_MS = '500';
    process.env.MONAD_VOICE_VAD_MIN_SPEECH_MS = '300';
    const opts = readVadOptsFromEnv();
    expect(opts.threshold).toBe(0.025);
    expect(opts.silenceMs).toBe(500);
    expect(opts.minSpeechMs).toBe(300);
  });

  it('rejects invalid / negative values silently', () => {
    process.env.MONAD_VOICE_VAD_THRESHOLD = 'abc';
    process.env.MONAD_VOICE_VAD_SILENCE_MS = '-100';
    const opts = readVadOptsFromEnv({});
    expect(opts.threshold).toBeUndefined();
    expect(opts.silenceMs).toBeUndefined();
  });
});
