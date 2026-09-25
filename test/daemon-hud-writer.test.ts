// PR-B1 — daemon-side token-gauge writer tests.
//
// Verifies the bridge from a finished prompt turn (input + output
// text · model) into a `token-gauge` HUD segment without any
// dashboard process involvement. Resets the metrics singleton in
// beforeEach so each case starts from a known-zero state.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  pushTokenGaugeFromTurn,
  TOKEN_GAUGE_SEGMENT_KEY,
  TOKEN_GAUGE_SEGMENT_PRIORITY,
} from '../src/nexus/api/daemon-hud-writer';
import { HudStore } from '../src/nexus/state/hud-store';
import { resetSessionMetrics } from '../src/status/metrics';

beforeEach(() => {
  resetSessionMetrics();
});

afterEach(() => {
  resetSessionMetrics();
});

describe('pushTokenGaugeFromTurn · happy path', () => {
  test('writes token-gauge segment with correct key + priority', () => {
    const hud = new HudStore();
    pushTokenGaugeFromTurn(hud, {
      model: 'claude-opus-4-6',
      inputText: 'hello'.repeat(100), // ~125 estimated tokens
      outputText: 'world'.repeat(50),
    });
    const seg = hud.get(TOKEN_GAUGE_SEGMENT_KEY);
    expect(seg).toBeDefined();
    expect(seg!.priority).toBe(TOKEN_GAUGE_SEGMENT_PRIORITY);
    expect(seg!.value).toContain('ctx');
    expect(seg!.value).toMatch(/\d+%/);
  });

  test('strips ANSI codes from the rendered gauge (PWA receives plain text)', () => {
    const hud = new HudStore();
    pushTokenGaugeFromTurn(hud, {
      model: 'grok-4.6',
      outputText: 'response',
    });
    const seg = hud.get(TOKEN_GAUGE_SEGMENT_KEY);
    expect(seg!.value).not.toMatch(/\x1b\[/);
  });

  test('tone reflects context-fill ratio (normal under warn threshold)', () => {
    const hud = new HudStore();
    pushTokenGaugeFromTurn(hud, {
      model: 'claude-opus-4-6', // 200k context window
      inputText: 'x'.repeat(40), // ~10 tokens used
      outputText: '',
    });
    expect(hud.get(TOKEN_GAUGE_SEGMENT_KEY)?.tone).toBe('normal');
  });

  test('tone warns above gaugeWarnRatio', () => {
    const hud = new HudStore();
    // Use the optional contextMax via gaugeCfg path — wire tested
    // separately. Here we force a tiny context window via a fake
    // model so even short text crosses the warn threshold.
    pushTokenGaugeFromTurn(hud, {
      model: 'unknown', // falls back to DEFAULT_TOKEN_BUDGET
      inputText: 'x'.repeat(4 * 80_000), // ~80k tokens
      outputText: '',
      gaugeCfg: { gaugeWarnRatio: 0.5, gaugeDangerRatio: 0.95 },
    });
    const tone = hud.get(TOKEN_GAUGE_SEGMENT_KEY)?.tone;
    expect(tone === 'warn' || tone === 'danger').toBe(true);
  });
});

describe('pushTokenGaugeFromTurn · dedupe + idempotency', () => {
  test('identical second push is a HudStore-level no-op (deep-equal)', () => {
    const hud = new HudStore();
    const events: string[] = [];
    hud.subscribe((ev) => events.push(ev.kind));
    // Same model + same texts → same usage → same segment payload.
    // First push fires, second one short-circuits in HudStore.set.
    pushTokenGaugeFromTurn(hud, { model: 'claude-opus-4-6', outputText: 'x' });
    pushTokenGaugeFromTurn(hud, { model: 'claude-opus-4-6', outputText: 'x' });
    expect(events).toEqual(['set']);
  });
});

describe('pushTokenGaugeFromTurn · empty-metrics guard', () => {
  test('does nothing when both texts are empty AND model is unknown', () => {
    const hud = new HudStore();
    // Empty input/output → recordTurn updates singleton with 0 used.
    // lastContextMax falls back to DEFAULT_TOKEN_BUDGET (positive),
    // so the segment WILL emit at 0% — confirm it's there but at
    // ratio 0 (not the "skip" path which only triggers on max=0).
    pushTokenGaugeFromTurn(hud, { model: 'unknown' });
    const seg = hud.get(TOKEN_GAUGE_SEGMENT_KEY);
    expect(seg).toBeDefined();
    expect(seg!.value).toContain('0%');
  });
});
