// FU1 — guard the FE Control urgency enum matches the BE.
//
// Origin: 2026-05-12 Dia CDP dogfood found that the ControlPanel dropdown
// used 'low | normal | high' while the daemon validator
// (src/input/control-signal-request.ts) only accepts
// 'background | normal | priority | quick-pass | critical'. Emitting from
// the UI with the FE-only urgencies returned `{error: bad_request}` from
// `/v1/control-signals`. This test pins both ends to the same closed set.

import { describe, expect, test } from 'bun:test';

import {
  CONTROL_URGENCIES,
  isControlUrgency,
} from '../../apps/pwa/src/lib/control-signals-api.ts';

describe('CONTROL_URGENCIES — FE enum', () => {
  test('matches the BE-accepted closed set', () => {
    const expected = new Set(['background', 'quick-pass', 'normal', 'priority', 'critical']);
    expect(new Set<string>(CONTROL_URGENCIES)).toEqual(expected);
  });

  test('isControlUrgency accepts members + rejects strangers', () => {
    for (const u of CONTROL_URGENCIES) expect(isControlUrgency(u)).toBe(true);
    expect(isControlUrgency('low')).toBe(false);    // <- old FE-only value
    expect(isControlUrgency('high')).toBe(false);   // <- old FE-only value
    expect(isControlUrgency('')).toBe(false);
    expect(isControlUrgency(null)).toBe(false);
  });
});

// Cross-reference: the BE validator that defines the enum. Imported
// directly so a future BE change forces this test to update both sides
// together.
describe('BE validator enum stays in sync', () => {
  test('every FE urgency passes BE parseControlSignalEmitBody', async () => {
    const { parseControlSignalEmitBody } = await import(
      '../../src/input/control-signal-request.ts'
    );
    for (const u of CONTROL_URGENCIES) {
      const out = parseControlSignalEmitBody({ kind: 'test', urgency: u });
      expect(out.ok).toBe(true);
    }
  });

  test('the old FE-only urgencies are rejected by the BE', async () => {
    const { parseControlSignalEmitBody } = await import(
      '../../src/input/control-signal-request.ts'
    );
    const lowOut = parseControlSignalEmitBody({ kind: 'test', urgency: 'low' });
    expect(lowOut.ok).toBe(false);
    const highOut = parseControlSignalEmitBody({ kind: 'test', urgency: 'high' });
    expect(highOut.ok).toBe(false);
  });
});
