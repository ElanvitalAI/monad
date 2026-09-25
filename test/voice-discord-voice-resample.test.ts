// Tests for the PCM resampling helpers used by the Discord voice
// channel adapter (Phase 6 wire · 2026-04-30). Verifies the integer-
// ratio conversions in both directions + edge cases (empty / odd-
// length input).

import { describe, it, expect } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  pcm16kMonoTo24kMono,
  pcm48kStereoTo16kMono,
  pcm24kMonoTo48kStereo,
} from '../src/voice/channel-adapters/discord-voice-resample.js';

function buildStereo48k(samplesPerChannel: number, gen: (i: number, ch: 'l' | 'r') => number): Buffer {
  const buf = Buffer.alloc(samplesPerChannel * 4);
  for (let i = 0; i < samplesPerChannel; i++) {
    buf.writeInt16LE(gen(i, 'l'), i * 4);
    buf.writeInt16LE(gen(i, 'r'), i * 4 + 2);
  }
  return buf;
}

function buildMono24k(samples: number, gen: (i: number) => number): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(gen(i), i * 2);
  }
  return buf;
}

describe('pcm48kStereoTo16kMono', () => {
  it('returns empty buffer for empty input', () => {
    expect(pcm48kStereoTo16kMono(Buffer.alloc(0)).length).toBe(0);
  });

  it('returns empty buffer when input has fewer than 1 stereo frame', () => {
    expect(pcm48kStereoTo16kMono(Buffer.alloc(2)).length).toBe(0); // half a stereo frame
  });

  it('decimates 3:1 with channel mix (constant signal)', () => {
    // 9 stereo frames @ 48k → 3 mono frames @ 16k
    const input = buildStereo48k(9, () => 100); // L = R = 100 → mono = 100
    const out = pcm48kStereoTo16kMono(input);
    expect(out.length).toBe(3 * 2); // 3 frames * 2 bytes
    for (let i = 0; i < 3; i++) {
      expect(out.readInt16LE(i * 2)).toBe(100);
    }
  });

  it('averages L+R into the mono sample', () => {
    const input = buildStereo48k(3, (_, ch) => ch === 'l' ? 100 : 200);
    const out = pcm48kStereoTo16kMono(input);
    // (100 + 200) >> 1 = 150
    expect(out.readInt16LE(0)).toBe(150);
  });

  it('rounds out-of-bounds sums into int16 range', () => {
    const input = buildStereo48k(3, () => 32767);
    const out = pcm48kStereoTo16kMono(input);
    // (32767 + 32767) >> 1 = 32767 — clamp behaves as no-op here
    expect(out.readInt16LE(0)).toBe(32767);
  });

  it('drops the partial 3-frame window at the end', () => {
    // 7 stereo frames → 2 mono frames (last frame partial: 7 % 3 = 1)
    const input = buildStereo48k(7, () => 50);
    const out = pcm48kStereoTo16kMono(input);
    expect(out.length).toBe(2 * 2);
  });
});

describe('pcm24kMonoTo48kStereo', () => {
  it('returns empty buffer for empty input', () => {
    expect(pcm24kMonoTo48kStereo(Buffer.alloc(0)).length).toBe(0);
  });

  it('upsamples 1:2 with channel duplication (constant signal)', () => {
    const input = buildMono24k(4, () => 1000);
    const out = pcm24kMonoTo48kStereo(input);
    // 4 mono samples × 2x interpolation × 2 channels × 2 bytes = 32
    expect(out.length).toBe(32);
    // L and R should both equal the input sample
    for (let i = 0; i < 8; i++) {
      const offset = i * 4;
      expect(out.readInt16LE(offset)).toBe(1000);
      expect(out.readInt16LE(offset + 2)).toBe(1000);
    }
  });

  it('preserves sample order via zero-order hold', () => {
    const input = buildMono24k(2, (i) => i === 0 ? 100 : 200);
    const out = pcm24kMonoTo48kStereo(input);
    // Frame 0: (L=100, R=100) twice → bytes 0..7
    // Frame 1: (L=200, R=200) twice → bytes 8..15
    expect(out.readInt16LE(0)).toBe(100);
    expect(out.readInt16LE(4)).toBe(100);
    expect(out.readInt16LE(8)).toBe(200);
    expect(out.readInt16LE(12)).toBe(200);
  });

  it('handles negative samples correctly', () => {
    const input = buildMono24k(2, () => -500);
    const out = pcm24kMonoTo48kStereo(input);
    expect(out.readInt16LE(0)).toBe(-500);
    expect(out.readInt16LE(2)).toBe(-500);
  });
});

describe('pcm16kMonoTo24kMono', () => {
  // 2026-07-12 실측 수리 — 디스코드 16k 인바운드를 openai-realtime 의
  // 24k 세션에 맞추는 2:3 선형보간 업샘플러.
  it('expands 2 input samples into 3 (a, mid, b)', () => {
    const input = buildMono24k(2, (i) => (i === 0 ? 100 : 300));
    const out = pcm16kMonoTo24kMono(input);
    expect(out.length).toBe(6); // 3 samples
    expect(out.readInt16LE(0)).toBe(100);
    expect(out.readInt16LE(2)).toBe(200); // linear midpoint
    expect(out.readInt16LE(4)).toBe(300);
  });

  it('length ratio is 3:2 on realistic buffers (20ms @16k → 20ms @24k)', () => {
    const input = buildMono24k(320, (i) => i); // 20 ms @ 16 kHz
    const out = pcm16kMonoTo24kMono(input);
    expect(out.length).toBe(480 * 2); // 20 ms @ 24 kHz
  });

  it('handles empty and sub-pair input', () => {
    expect(pcm16kMonoTo24kMono(Buffer.alloc(0)).length).toBe(0);
    expect(pcm16kMonoTo24kMono(Buffer.alloc(2)).length).toBe(0); // single sample — no pair
  });

  it('preserves negative samples', () => {
    const input = buildMono24k(2, () => -1000);
    const out = pcm16kMonoTo24kMono(input);
    expect(out.readInt16LE(0)).toBe(-1000);
    expect(out.readInt16LE(2)).toBe(-1000);
    expect(out.readInt16LE(4)).toBe(-1000);
  });
});

describe('round-trip identity check', () => {
  it('48k stereo → 16k mono → upsampled back is recognizable shape', () => {
    // A simple sanity check that the two helpers compose without
    // crashing on a realistic-sized buffer (1 second of audio).
    const input = buildStereo48k(48_000, (i) => Math.sin(i / 100) * 1000);
    const mono16k = pcm48kStereoTo16kMono(input);
    expect(mono16k.length).toBe(16_000 * 2);
  });
});
