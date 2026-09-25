// M4c AEC-lite — reference-signal echo classifier DSP tests with
// deterministic synthetic signals (seeded LCG noise + sine mixes).

import { describe, expect, it } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createDiscordVoiceEchoClassifier } from '../src/voice/channel-adapters/discord-voice-echo-classifier.js';
import { pcm24kMonoTo16kMono } from '../src/voice/channel-adapters/discord-voice-resample.js';

const SR = 16_000;

/** Deterministic LCG — no Math.random so runs are reproducible. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

/** Speech-ish signal: band of sines + noise, amplitude-modulated. */
function synthSpeech(samples: number, seed: number): Float64Array {
  const rnd = makeLcg(seed);
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / SR;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3.1 * t + seed);
    out[i] = env * (
      Math.sin(2 * Math.PI * (140 + 17 * (seed % 7)) * t)
      + 0.6 * Math.sin(2 * Math.PI * (410 + 31 * (seed % 5)) * t)
      + 0.35 * rnd()
    );
  }
  return out;
}

function toPcm(x: Float64Array, gain: number, from = 0, len = x.length - 0): Buffer {
  const n = Math.min(len, x.length - from);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(x[from + i]! * gain)));
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

describe('discord voice echo classifier', () => {
  it('flags a delayed, attenuated copy of the reference as echo', () => {
    const clf = createDiscordVoiceEchoClassifier();
    const speech = synthSpeech(SR * 2, 7); // 2 s of bot speech
    clf.noteReference(toPcm(speech, 8000));
    expect(clf.hasReference()).toBe(true);
    // Echo: same waveform, 240 ms lagged window, half volume + noise.
    const lagSamples = Math.floor(SR * 0.24);
    const frameStart = SR * 2 - lagSamples - 320; // 20 ms frame
    const rnd = makeLcg(99);
    const echoFrame = Buffer.alloc(320 * 2);
    for (let i = 0; i < 320; i++) {
      const v = speech[frameStart + i]! * 4000 + rnd() * 400;
      echoFrame.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
    }
    const verdict = clf.classify(echoFrame);
    expect(verdict.echo).toBe(true);
    expect(verdict.ncc).toBeGreaterThan(0.8);
    // Lag ≈ 240 ms + frame length (frame START sits lag+320 behind tail).
    expect(Math.abs(verdict.lagMs - 260)).toBeLessThan(30);
  });

  it('passes genuinely independent speech (low correlation)', () => {
    const clf = createDiscordVoiceEchoClassifier();
    clf.noteReference(toPcm(synthSpeech(SR * 2, 7), 8000));
    const user = synthSpeech(SR, 1234); // different seed → independent
    const verdict = clf.classify(toPcm(user, 6000, 1000, 320));
    expect(verdict.echo).toBe(false);
    expect(verdict.ncc).toBeLessThan(0.5);
  });

  it('declines to classify without sufficient reference', () => {
    const clf = createDiscordVoiceEchoClassifier();
    expect(clf.hasReference()).toBe(false);
    const verdict = clf.classify(toPcm(synthSpeech(320, 3), 5000));
    expect(verdict.echo).toBe(false);
  });

  it('reference window stays bounded (4s cap) and still matches recent audio', () => {
    const clf = createDiscordVoiceEchoClassifier();
    // Feed 10 s in 1 s chunks — only the last ~4 s must be retained.
    let last: Float64Array | null = null;
    for (let k = 0; k < 10; k++) {
      last = synthSpeech(SR, 40 + k);
      clf.noteReference(toPcm(last, 8000));
    }
    const frame = toPcm(last!, 4000, SR - 800, 320); // near tail
    expect(clf.classify(frame).echo).toBe(true);
  });

  it('pcm24kMonoTo16kMono downsamples 3:2 and preserves duration', () => {
    // 24k: 1 s = 24000 samples → 16k: 16000 samples.
    const input = Buffer.alloc(24_000 * 2);
    for (let i = 0; i < 24_000; i++) input.writeInt16LE(1000, i * 2);
    const out = pcm24kMonoTo16kMono(input);
    expect(out.length).toBe(16_000 * 2);
    expect(out.readInt16LE(0)).toBe(1000);
    expect(out.readInt16LE(2)).toBe(1000);
  });
});
