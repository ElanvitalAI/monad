// PR-S1V.10 (sprint 22 Phase 5 · 2026-04-29) — Local energy-based VAD.
//
// Pure JS RMS detector — feeds raw PCM 16-bit signed mono samples,
// emits `onSpeechStart` once cumulative active frames exceed
// `minSpeechMs`, then `onSpeechEnd` after `silenceMs` of below-threshold
// silence. No native deps, no subprocess — fast enough to run inline
// per audio chunk on the dashboard event loop.
//
// Used as a Phase 5 fallback when the configured streaming STT
// provider lacks server-side VAD (e.g., whisper-cpp-local). For
// providers with built-in VAD (openai-realtime / gemini-live), this
// detector is bypassed by the pipeline.
//
// Reference: ROADMAP §6.1.

import { debug } from '../../debug/log.js';

export interface VadOpts {
  /** Sample rate (Hz). Must match the input PCM. Default 16000. */
  sampleRate?: number;
  /** Frame size in milliseconds for RMS calculation. Default 30 ms. */
  frameMs?: number;
  /** Threshold (0-1 normalized RMS) for active-frame detection.
   *  Tuned default for typical mic levels: 0.012 — adjust via env if
   *  the room is noisy or the mic is hot. */
  threshold?: number;
  /** Cumulative active duration before `onSpeechStart` fires.
   *  Filters out clicks / breath noise. Default 200 ms. */
  minSpeechMs?: number;
  /** Trailing below-threshold duration that ends the utterance.
   *  Default 800 ms (Gemini-style). */
  silenceMs?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export interface VadDetector {
  /** Feed a PCM chunk (16-bit signed mono LE). Internal accumulator
   *  is byte-level so a chunk that splits a sample is handled correctly. */
  push(pcm: Buffer): void;
  /** Reset state — speech end fires *if* in-utterance. */
  reset(): void;
  /** True between speech-start and speech-end events. */
  isInSpeech(): boolean;
  /** Diagnostic — returns the latest computed RMS (0..1 normalized). */
  lastRms(): number;
}

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 30;
const DEFAULT_THRESHOLD = 0.012;
const DEFAULT_MIN_SPEECH_MS = 200;
const DEFAULT_SILENCE_MS = 800;
const INT16_MAX = 32768;

export function createVadDetector(opts: VadOpts = {}): VadDetector {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const frameMs = opts.frameMs ?? DEFAULT_FRAME_MS;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const minSpeechMs = opts.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const silenceMs = opts.silenceMs ?? DEFAULT_SILENCE_MS;

  // Frame size in samples × 2 bytes/sample.
  const frameSamples = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
  const frameBytes = frameSamples * 2;

  // Carry buffer for incomplete-frame leftovers across pushes.
  let carry = Buffer.alloc(0);

  // Cumulative active / silence durations (ms).
  let activeMs = 0;
  let silenceAccumMs = 0;
  let inSpeech = false;
  let rms = 0;

  function push(pcm: Buffer): void {
    // Combine carry + new chunk; process all complete frames.
    const buf = carry.length > 0 ? Buffer.concat([carry, pcm]) : pcm;
    let i = 0;
    const limit = buf.length - (buf.length % frameBytes);
    while (i < limit) {
      const frame = buf.subarray(i, i + frameBytes);
      processFrame(frame);
      i += frameBytes;
    }
    carry = i < buf.length ? Buffer.from(buf.subarray(i)) : Buffer.alloc(0);
  }

  function processFrame(frame: Buffer): void {
    let sumSq = 0;
    for (let s = 0; s < frame.length; s += 2) {
      const sample = frame.readInt16LE(s);
      const norm = sample / INT16_MAX;
      sumSq += norm * norm;
    }
    const samples = frame.length / 2;
    rms = Math.sqrt(sumSq / samples);
    const active = rms >= threshold;
    if (active) {
      activeMs += frameMs;
      silenceAccumMs = 0;
      if (!inSpeech && activeMs >= minSpeechMs) {
        inSpeech = true;
        if (debug.enabled)
          debug.log('voice.vad', 'speech-start', { rms: Number(rms.toFixed(4)) });
        opts.onSpeechStart?.();
      }
    } else {
      // Reset cumulative active when silence creeps in BEFORE we fully
      // committed to speech — small click shouldn't pre-warm the next
      // utterance.
      if (!inSpeech) activeMs = 0;
      else {
        silenceAccumMs += frameMs;
        if (silenceAccumMs >= silenceMs) {
          inSpeech = false;
          activeMs = 0;
          silenceAccumMs = 0;
          if (debug.enabled)
            debug.log('voice.vad', 'speech-end', { rms: Number(rms.toFixed(4)) });
          opts.onSpeechEnd?.();
        }
      }
    }
  }

  function reset(): void {
    if (inSpeech) {
      inSpeech = false;
      opts.onSpeechEnd?.();
    }
    carry = Buffer.alloc(0);
    activeMs = 0;
    silenceAccumMs = 0;
    rms = 0;
  }

  return {
    push,
    reset,
    isInSpeech: () => inSpeech,
    lastRms: () => rms,
  };
}

// ── Env reading ────────────────────────────────────────────────────

export type VadMode = 'server' | 'local' | 'manual';

/** Priority: explicit `configOverride` > env (`ELANOUS_VOICE_VAD`) > fallback. */
export function resolveVadModeFromEnv(
  fallback: VadMode = 'server',
  opts: { configOverride?: VadMode } = {},
): VadMode {
  if (opts.configOverride) return opts.configOverride;
  const raw = process.env.ELANOUS_VOICE_VAD?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'server' || raw === 'local' || raw === 'manual') return raw;
  return fallback;
}

/** Layer order (lowest → highest precedence): `base` (caller-provided
 *  hardcoded), env (`ELANOUS_VOICE_VAD_*`), `configOverride` (from
 *  user-config). User config wins over env wins over base. */
export function readVadOptsFromEnv(
  base: VadOpts = {},
  opts: {
    configOverride?: { threshold?: number; silenceMs?: number; minSpeechMs?: number };
  } = {},
): VadOpts {
  const out: VadOpts = { ...base };
  const t = readPositiveFloat('ELANOUS_VOICE_VAD_THRESHOLD');
  if (t !== undefined) out.threshold = t;
  const sm = readPositiveInt('ELANOUS_VOICE_VAD_SILENCE_MS');
  if (sm !== undefined) out.silenceMs = sm;
  const mm = readPositiveInt('ELANOUS_VOICE_VAD_MIN_SPEECH_MS');
  if (mm !== undefined) out.minSpeechMs = mm;
  // Config override has the final say.
  const cfg = opts.configOverride;
  if (cfg) {
    if (typeof cfg.threshold === 'number') out.threshold = cfg.threshold;
    if (typeof cfg.silenceMs === 'number') out.silenceMs = cfg.silenceMs;
    if (typeof cfg.minSpeechMs === 'number') out.minSpeechMs = cfg.minSpeechMs;
  }
  return out;
}

function readPositiveInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function readPositiveFloat(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
