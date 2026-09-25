import { describe, expect, test } from 'bun:test';
import {
  computeFrameRms,
  createRmsActivityDetector,
  FRAME_SAMPLES_DEFAULT,
} from './barge-in';

/** Build an int16 LE PCM frame whose every sample carries `value`. */
function frameAtAmplitude(value: number, samples = FRAME_SAMPLES_DEFAULT): Uint8Array {
  const buf = new ArrayBuffer(samples * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples; i += 1) {
    view.setInt16(i * 2, value, true);
  }
  return new Uint8Array(buf);
}

describe('barge-in · computeFrameRms', () => {
  test('returns 0 for an empty frame', () => {
    expect(computeFrameRms(new Uint8Array(0))).toBe(0);
  });

  test('returns 0 for an all-silence frame', () => {
    expect(computeFrameRms(frameAtAmplitude(0))).toBe(0);
  });

  test('matches |amplitude / 32768| for a constant-amplitude frame', () => {
    // A flat amplitude waveform has RMS = |a|.
    const half = frameAtAmplitude(16384); // 0.5 of full scale
    expect(computeFrameRms(half)).toBeCloseTo(0.5, 4);
    const eighth = frameAtAmplitude(4096); // 0.125
    expect(computeFrameRms(eighth)).toBeCloseTo(0.125, 4);
  });

  test('handles negative-amplitude frames symmetrically', () => {
    expect(computeFrameRms(frameAtAmplitude(-16384))).toBeCloseTo(0.5, 4);
  });
});

describe('barge-in · createRmsActivityDetector', () => {
  test('emits exactly once on rising edge after sustain band', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 100,
      frameMs: 20, // 5 frames of sustain required
    });
    // Sub-threshold quiet — never fires.
    for (let i = 0; i < 10; i += 1) {
      expect(det.push(frameAtAmplitude(0))).toBe(false);
    }
    // 4 above-threshold frames — still in sustain band, no fire yet.
    const loud = frameAtAmplitude(8000); // ~0.244 RMS
    for (let i = 0; i < 4; i += 1) {
      expect(det.push(loud)).toBe(false);
    }
    // 5th frame crosses sustain — fires exactly once.
    expect(det.push(loud)).toBe(true);
    // Continuing loud frames do NOT re-fire (already activated).
    for (let i = 0; i < 5; i += 1) {
      expect(det.push(loud)).toBe(false);
    }
  });

  test('rejects single-frame spikes below sustain', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 100,
      frameMs: 20,
    });
    const loud = frameAtAmplitude(8000);
    const quiet = frameAtAmplitude(0);
    // Spike — single loud frame surrounded by quiet.
    expect(det.push(loud)).toBe(false);
    expect(det.push(quiet)).toBe(false);
    expect(det.push(quiet)).toBe(false);
    expect(det.push(loud)).toBe(false);
    expect(det.push(quiet)).toBe(false);
    // Never activated — sustain never met.
  });

  test('re-arms after sustained quiet for next utterance', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 40, // 2 frames @ 20ms
      frameMs: 20,
    });
    const loud = frameAtAmplitude(8000);
    const quiet = frameAtAmplitude(0);
    // First activation.
    det.push(loud);
    expect(det.push(loud)).toBe(true);
    // Stay activated — extra loud frames don't re-fire.
    expect(det.push(loud)).toBe(false);
    // 25 quiet frames = 500ms — re-arms.
    for (let i = 0; i < 25; i += 1) {
      det.push(quiet);
    }
    // Next utterance fires again on the 2nd sustain frame.
    det.push(loud);
    expect(det.push(loud)).toBe(true);
  });

  test('reset() forces re-arming immediately', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 20,
      frameMs: 20,
    });
    const loud = frameAtAmplitude(8000);
    expect(det.push(loud)).toBe(true);
    expect(det.push(loud)).toBe(false);
    det.reset();
    expect(det.push(loud)).toBe(true);
  });

  test('uses default threshold/sustain when no opts given', () => {
    const det = createRmsActivityDetector();
    // ~0.244 RMS far above 0.04 default — fires within ≤8 frames
    // (DEFAULT_SUSTAIN_MS=150ms ÷ 20ms/frame = 8 frames).
    const loud = frameAtAmplitude(8000);
    let fired = false;
    for (let i = 0; i < 12; i += 1) {
      if (det.push(loud)) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });
});

// BI-2 (Phase 2 · 2026-05-10) — speaking-aware threshold ducking.
describe('barge-in · setSpeakingActive ducking', () => {
  test('effectiveThreshold doubles when speaking active (default 2x)', () => {
    const det = createRmsActivityDetector({ threshold: 0.04 });
    expect(det.effectiveThreshold()).toBeCloseTo(0.04, 5);
    det.setSpeakingActive(true);
    expect(det.effectiveThreshold()).toBeCloseTo(0.08, 5);
    det.setSpeakingActive(false);
    expect(det.effectiveThreshold()).toBeCloseTo(0.04, 5);
  });

  test('custom multiplier applied (e.g. 1.5x)', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      speakingThresholdMultiplier: 1.5,
    });
    det.setSpeakingActive(true);
    expect(det.effectiveThreshold()).toBeCloseTo(0.06, 5);
  });

  test('multiplier=1.0 disables ducking (legacy BI-1 behavior)', () => {
    const det = createRmsActivityDetector({
      threshold: 0.04,
      speakingThresholdMultiplier: 1.0,
    });
    det.setSpeakingActive(true);
    expect(det.effectiveThreshold()).toBeCloseTo(0.04, 5);
  });

  test('echo-level frame fires under base threshold but NOT during speaking', () => {
    // Acoustic echo post-AEC ≈ 0.05 — over base 0.04 (would activate)
    // but under speaking-mode 0.08 (suppressed).
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 20,
      frameMs: 20,
    });
    // Frame at amplitude 1638 (~0.05 RMS) — between 0.04 and 0.08.
    const echoLevel = frameAtAmplitude(1638);
    // BASE mode: fires.
    expect(det.push(echoLevel)).toBe(true);
    det.reset();
    // SPEAKING mode: same frame, suppressed.
    det.setSpeakingActive(true);
    let fired = false;
    for (let i = 0; i < 10; i += 1) {
      if (det.push(echoLevel)) { fired = true; break; }
    }
    expect(fired).toBe(false);
  });

  test('real-speech-level frame fires even during speaking (real barge-in)', () => {
    // User actually speaks ≈ 0.244 RMS — well above 0.08 speaking-mode
    // threshold so auto barge-in still triggers.
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 20,
      frameMs: 20,
    });
    det.setSpeakingActive(true);
    const speech = frameAtAmplitude(8000);
    expect(det.push(speech)).toBe(true);
  });

  test('idempotent — calling setSpeakingActive with same value is no-op', () => {
    const det = createRmsActivityDetector({ threshold: 0.04 });
    det.setSpeakingActive(false);
    det.setSpeakingActive(false);
    expect(det.effectiveThreshold()).toBeCloseTo(0.04, 5);
    det.setSpeakingActive(true);
    det.setSpeakingActive(true);
    expect(det.effectiveThreshold()).toBeCloseTo(0.08, 5);
  });

  test('toggling speaking resets hysteresis counters (band re-builds)', () => {
    // Setup: in speaking mode with echo-level frames building up.
    const det = createRmsActivityDetector({
      threshold: 0.04,
      sustainMs: 60,
      frameMs: 20, // 3 frames sustain required
    });
    det.setSpeakingActive(true);
    const echoLevel = frameAtAmplitude(1638); // 0.05 — under 0.08 mode
    for (let i = 0; i < 5; i += 1) det.push(echoLevel);
    // Toggle off — counter resets.
    det.setSpeakingActive(false);
    // Need fresh sustain band even though prior frames were under
    // base threshold.
    expect(det.push(echoLevel)).toBe(false); // 1 of 3 frames
    expect(det.push(echoLevel)).toBe(false); // 2 of 3 frames
    expect(det.push(echoLevel)).toBe(true);  // 3 of 3 — fires
  });
});
