// M4c follow-up (2026-07-12) — reference-signal echo CLASSIFIER for
// Discord voice barge-in (업계 표준 AEC 패턴의 분류형 변주).
//
// Why a classifier, not a subtractive NLMS canceller: the echo path
// (bot TTS → user speaker → user mic → Discord client DSP → opus →
// our decoder) has an unknown, drifting delay and heavy nonlinear
// processing (Discord noise suppression). An adaptive subtractive
// filter fights convergence forever; a normalized-cross-correlation
// classifier only has to answer "does this inbound frame LOOK like
// something we recently played?" — robust to gain/DSP, cheap, and
// wrong in the safe direction (double-talk during echo gets dropped,
// the sustained-speech gate still admits real interruptions).
//
// Wire shape (discord-voice-channel-harness.ts):
//   - every outbound TTS chunk (24k mono) → downsample → noteReference
//   - every inbound frame (16k mono) while the bot is audibly speaking
//     → classify() → echo ⇒ drop before STT
//
// DSP: two-stage NCC search over a rolling reference window.
//   coarse: both signals block-averaged ×8 (2 kHz) → full-window lag
//           scan at stride 8
//   fine:   ±8 full-rate lags around the coarse peak
// Cost per 20 ms frame ≈ 70k mults — negligible.

import { Buffer } from 'node:buffer';

export interface EchoClassifierOpts {
  /** Reference/inbound sample rate. Discord inbound contract = 16 kHz. */
  sampleRate?: number;
  /** Rolling reference window length in seconds. Must cover playback
   *  latency + echo tail (network + client buffer ≈ 0.1–1 s). */
  windowSecs?: number;
  /** NCC above this ⇒ frame is the bot's own echo. 0.5 keeps Discord's
   *  nonlinear client DSP from hiding the match while independent
   *  speech stays far below (uncorrelated ⇒ |ncc| ≪ 0.3). */
  nccThreshold?: number;
}

export interface EchoVerdict {
  echo: boolean;
  /** Best normalized cross-correlation found (0..1). */
  ncc: number;
  /** Lag of the match, in ms behind the newest reference sample. */
  lagMs: number;
}

export interface DiscordVoiceEchoClassifier {
  /** Feed the bot's own outbound audio (16 kHz mono s16 Buffer). */
  noteReference(pcm16k: Buffer): void;
  /** Classify an inbound frame (16 kHz mono s16 Buffer). */
  classify(pcm16k: Buffer): EchoVerdict;
  /** True when enough reference audio exists to classify against. */
  hasReference(): boolean;
  reset(): void;
}

const COARSE = 8; // decimation factor for the coarse lag scan

export function createDiscordVoiceEchoClassifier(
  opts: EchoClassifierOpts = {},
): DiscordVoiceEchoClassifier {
  const sampleRate = opts.sampleRate ?? 16_000;
  const windowSecs = opts.windowSecs ?? 4;
  const nccThreshold = opts.nccThreshold ?? 0.5;
  const cap = sampleRate * windowSecs;

  // Rolling reference — flat Float32Array kept "newest at the end" by
  // shifting on overflow (windowSecs is small; a shift every ~4 s of
  // speech is cheaper than ring-index gymnastics in every NCC loop).
  let ref = new Float32Array(0);

  function noteReference(pcm16k: Buffer): void {
    const n = Math.floor(pcm16k.length / 2);
    if (n === 0) return;
    const add = new Float32Array(n);
    for (let i = 0; i < n; i++) add[i] = pcm16k.readInt16LE(i * 2);
    const total = ref.length + n;
    if (total <= cap) {
      const next = new Float32Array(total);
      next.set(ref, 0);
      next.set(add, ref.length);
      ref = next;
    } else {
      const keep = Math.min(ref.length, cap - Math.min(n, cap));
      const next = new Float32Array(keep + Math.min(n, cap));
      next.set(ref.subarray(ref.length - keep), 0);
      next.set(add.subarray(Math.max(0, n - cap)), keep);
      ref = next;
    }
  }

  /** Block-average decimation (crude low-pass + downsample). */
  function decimate(x: Float32Array, factor: number): Float32Array {
    const n = Math.floor(x.length / factor);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const base = i * factor;
      for (let j = 0; j < factor; j++) s += x[base + j]!;
      out[i] = s / factor;
    }
    return out;
  }

  /** NCC of `frame` against `sig` starting at offset `at`. */
  function nccAt(sig: Float32Array, at: number, frame: Float32Array): number {
    let dot = 0;
    let ea = 0;
    let eb = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = sig[at + i]!;
      const b = frame[i]!;
      dot += a * b;
      ea += a * a;
      eb += b * b;
    }
    if (ea === 0 || eb === 0) return 0;
    return Math.abs(dot) / Math.sqrt(ea * eb);
  }

  function classify(pcm16k: Buffer): EchoVerdict {
    const n = Math.floor(pcm16k.length / 2);
    if (n < 64 || ref.length < n * 2) return { echo: false, ncc: 0, lagMs: 0 };
    const frame = new Float32Array(n);
    for (let i = 0; i < n; i++) frame[i] = pcm16k.readInt16LE(i * 2);

    // Coarse scan at 1/COARSE rate over the whole reference window.
    const cFrame = decimate(frame, COARSE);
    const cRef = decimate(ref, COARSE);
    if (cFrame.length < 8 || cRef.length <= cFrame.length) {
      return { echo: false, ncc: 0, lagMs: 0 };
    }
    let bestC = 0;
    let bestCAt = 0;
    const cMax = cRef.length - cFrame.length;
    for (let at = 0; at <= cMax; at++) {
      const v = nccAt(cRef, at, cFrame);
      if (v > bestC) { bestC = v; bestCAt = at; }
    }

    // Fine scan ±COARSE full-rate lags around the coarse peak.
    let best = 0;
    let bestAt = bestCAt * COARSE;
    const lo = Math.max(0, bestCAt * COARSE - COARSE);
    const hi = Math.min(ref.length - n, bestCAt * COARSE + COARSE);
    for (let at = lo; at <= hi; at++) {
      const v = nccAt(ref, at, frame);
      if (v > best) { best = v; bestAt = at; }
    }

    const lagSamples = ref.length - bestAt; // behind newest ref sample
    return {
      echo: best >= nccThreshold,
      ncc: best,
      lagMs: Math.round((lagSamples / sampleRate) * 1000),
    };
  }

  return {
    noteReference,
    classify,
    hasReference: () => ref.length >= sampleRate / 5, // ≥200 ms
    reset: () => { ref = new Float32Array(0); },
  };
}
