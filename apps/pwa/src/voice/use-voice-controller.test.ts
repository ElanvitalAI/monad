/**
 * Phase 1 (PWA chat ↔ voice 일원화 · 2026-05-07) — pure helper tests
 * for `use-voice-controller`.
 *
 * The hook itself wires React state + refs around three transport
 * factories (createVoiceSocket / startVoiceCapture / createVoicePlayback).
 * The factories are exercised in their own files; here we lock the two
 * pure phase-mapping helpers — those decide what the user sees in the
 * mic button and on the eventual Phase 3 voice overlay.
 */

import { describe, expect, it } from 'bun:test';
import {
  MIC_DUCK_GAIN,
  mapServerState,
  mapSocketState,
  micGainForPhase,
} from './use-voice-controller';

describe('mapServerState', () => {
  it('translates server transitions to UI phases', () => {
    expect(mapServerState('connecting')).toBe('connecting');
    expect(mapServerState('streaming')).toBe('listening');
    expect(mapServerState('closing')).toBe('idle');
    expect(mapServerState('closed')).toBe('idle');
  });

  it('falls back to idle on unknown server state (forward-compat)', () => {
    expect(mapServerState('frobnicated')).toBe('idle');
    expect(mapServerState('')).toBe('idle');
  });
});

describe('mapSocketState', () => {
  it('maps lifecycle states to phases', () => {
    expect(mapSocketState('connecting')).toBe('connecting');
    expect(mapSocketState('error')).toBe('error');
    expect(mapSocketState('closed')).toBe('idle');
  });

  it('returns null for open + idle so the server state wins', () => {
    expect(mapSocketState('open')).toBeNull();
    expect(mapSocketState('idle')).toBeNull();
    expect(mapSocketState('closing')).toBeNull();
  });
});

describe('micGainForPhase (BI-2 ducking · 2026-05-10)', () => {
  it('drops to MIC_DUCK_GAIN while TTS is playing', () => {
    expect(micGainForPhase('speaking')).toBe(MIC_DUCK_GAIN);
    // -6dB ≈ 0.5012 amplitude. Lock the constant so callers can reason
    // about the audible effect (and so the BI-2 hysteresis margin is
    // explicit in the test, not just code).
    expect(MIC_DUCK_GAIN).toBe(0.5);
  });

  it('returns 1.0 for every non-speaking phase', () => {
    const phases: ReadonlyArray<Parameters<typeof micGainForPhase>[0]> = [
      'idle',
      'connecting',
      'listening',
      'processing',
      'error',
    ];
    for (const p of phases) expect(micGainForPhase(p)).toBe(1);
  });
});
