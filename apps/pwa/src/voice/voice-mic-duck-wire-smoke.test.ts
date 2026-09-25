// BI-2 mic ducking — source-level wire smoke (regression for the
// failure mode "GainNode lands but never gets attached").
//
// The actual ducking effect lives in browser code we can't unit-test
// from bun (`AudioContext`, `GainNode`, `AudioWorkletNode`). What we
// CAN guard is that the wire exists in source: the capture path inserts
// a GainNode between the MediaStreamSource and the worklet, exposes
// `setMicGain`, and the controller calls it from `setPhaseSync` only
// on phase transitions. Source-level grep is intentionally simple +
// brittle — that brittleness is the point: anyone touching the wire
// will trip this test before the production bug ships (decoupled gain,
// gain spam every 20ms PCM frame, etc).
//
// See also:
//   - apps/pwa/src/voice/use-voice-controller.test.ts (pure helper)
//   - feedback_source_level_grep_test_value.md (memory)

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

function readSource(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('voice-capture · GainNode wire (BI-2 ducking · 2026-05-10)', () => {
  test('voice-capture.ts inserts a GainNode between source and worklet', () => {
    const src = readSource('apps/pwa/src/voice/voice-capture.ts');
    expect(src).toMatch(/ctx\.createGain\s*\(\s*\)/);
    // The worklet must receive the post-gain signal — guards against
    // someone wiring source.connect(node) directly and only calling
    // gain on a side branch (where ducking would have no effect).
    expect(src).toMatch(/source\.connect\(\s*gain\s*\)/);
    expect(src).toMatch(/gain\.connect\(\s*node\s*\)/);
  });

  test('voice-capture.ts exposes setMicGain on the handle', () => {
    const src = readSource('apps/pwa/src/voice/voice-capture.ts');
    // Interface declaration.
    expect(src).toMatch(/setMicGain\s*\(\s*value:\s*number\s*\)\s*:\s*void/);
    // Implementation clamps + writes to gain.gain. The clamp guards
    // against accidental >1 boosts that would amplify echo instead of
    // attenuating it.
    expect(src).toMatch(/setMicGain\s*\(\s*value:\s*number\s*\)\s*\{/);
    expect(src).toMatch(/Math\.max\(\s*0\s*,\s*Math\.min\(\s*1\s*,\s*value\s*\)\s*\)/);
  });
});

describe('use-voice-controller · setPhaseSync wires mic gain (BI-2 · 2026-05-10)', () => {
  test('exports MIC_DUCK_GAIN and micGainForPhase', () => {
    const src = readSource('apps/pwa/src/voice/use-voice-controller.ts');
    expect(src).toMatch(/export\s+const\s+MIC_DUCK_GAIN\s*=\s*0\.5/);
    expect(src).toMatch(/export\s+function\s+micGainForPhase\s*\(/);
  });

  test('setPhaseSync calls captureRef.current?.setMicGain on phase transition', () => {
    const src = readSource('apps/pwa/src/voice/use-voice-controller.ts');
    expect(src).toMatch(/captureRef\.current\?\.setMicGain\s*\(\s*micGainForPhase\s*\(/);
  });

  test('gain call is gated on phase transition (avoids 20ms-per-frame spam)', () => {
    // Without the transition guard, `onDownstreamPcm` would re-fire
    // setMicGain(0.5) for every PCM frame the daemon emits (~20ms),
    // cancelling and re-scheduling the gain ramp on every frame.
    const src = readSource('apps/pwa/src/voice/use-voice-controller.ts');
    expect(src).toMatch(/micGainForPhase\(\s*prev\s*\)\s*!==\s*micGainForPhase\(\s*next\s*\)/);
  });
});
