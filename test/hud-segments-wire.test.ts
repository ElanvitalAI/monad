// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M5 — token-gauge +
// variant HUD wire tests.
//
// Invariants:
//  1. setTokenGaugeSegment writes the renderTokenGauge string under
//     `token-gauge` key at priority 5.
//  2. setTokenGaugeSegment clears when max <= 0 / non-finite (no
//     context budget known).
//  3. setVariantBadgeSegment writes the renderVariantBadge string
//     under `variant` key at priority 1.
//  4. panes/hud.ts setSegment dedupes deep-equal writes — repeated
//     identical calls don't fire subscribers twice (matches the
//     HudStore daemon-side dedupe behaviour expected by M3 mirror).

import { describe, expect, test } from 'bun:test';

import {
  setTokenGaugeSegment,
  setVariantBadgeSegment,
  TOKEN_GAUGE_SEGMENT_KEY,
  TOKEN_GAUGE_SEGMENT_PRIORITY,
  VARIANT_SEGMENT_KEY,
  VARIANT_SEGMENT_PRIORITY,
} from '../src/chat/hud-segments-wire.js';
import {
  createHud,
  subscribe,
  setSegment,
  type HudSubscriber,
} from '../src/panes/hud.js';

const TONE_CFG = { gaugeWarnRatio: 0.7, gaugeDangerRatio: 0.9 } as const;

// ── setTokenGaugeSegment ─────────────────────────────────────────────

describe('setTokenGaugeSegment', () => {
  test('writes the gauge under token-gauge key at priority 5', () => {
    const hud = createHud();
    setTokenGaugeSegment(hud, 50, 100, TONE_CFG);
    const seg = hud.segments[TOKEN_GAUGE_SEGMENT_KEY];
    expect(seg).toBeDefined();
    expect(seg!.priority).toBe(TOKEN_GAUGE_SEGMENT_PRIORITY);
    expect(seg!.value).toContain('50%');
    expect(seg!.value).toContain('ctx');
  });

  test('clears segment when max <= 0 (unknown budget)', () => {
    const hud = createHud();
    setTokenGaugeSegment(hud, 50, 100, TONE_CFG);
    setTokenGaugeSegment(hud, 0, 0, TONE_CFG);
    expect(hud.segments[TOKEN_GAUGE_SEGMENT_KEY]).toBeUndefined();
  });

  test('clears segment when max is non-finite', () => {
    const hud = createHud();
    setTokenGaugeSegment(hud, 50, 100, TONE_CFG);
    setTokenGaugeSegment(hud, 50, Number.NaN, TONE_CFG);
    expect(hud.segments[TOKEN_GAUGE_SEGMENT_KEY]).toBeUndefined();
  });

  test('emits subscriber event on first write', () => {
    const hud = createHud();
    const events: Array<{ kind: string; key: string }> = [];
    subscribe(hud, ((ev) => events.push({ kind: ev.kind, key: ev.key })) as HudSubscriber);
    setTokenGaugeSegment(hud, 50, 100, TONE_CFG);
    expect(events).toEqual([{ kind: 'set', key: 'token-gauge' }]);
  });
});

// ── setVariantBadgeSegment ───────────────────────────────────────────

describe('setVariantBadgeSegment', () => {
  test('writes the variant badge under variant key at priority 1', () => {
    const hud = createHud();
    setVariantBadgeSegment(hud, {
      providerInfo: { provider: 'grok', model: 'grok-4.6', auth: 'apikey', authDetail: '' },
      systemPrompt: { taskVariant: 'default' } as {
        taskVariant: 'default';
        overridePath?: string;
      },
      width: 120,
    });
    const seg = hud.segments[VARIANT_SEGMENT_KEY];
    expect(seg).toBeDefined();
    expect(seg!.priority).toBe(VARIANT_SEGMENT_PRIORITY);
    expect(seg!.value).toContain('↯');
  });

  test('override path renders the override marker', () => {
    const hud = createHud();
    setVariantBadgeSegment(hud, {
      providerInfo: { provider: 'grok', model: 'grok-4.6', auth: 'apikey', authDetail: '' },
      systemPrompt: {
        taskVariant: 'default',
        overridePath: '/path/to/monad.md',
      } as {
        taskVariant: 'default';
        overridePath: string;
      },
      width: 120,
    });
    const seg = hud.segments[VARIANT_SEGMENT_KEY];
    expect(seg!.value).toContain('override');
    expect(seg!.value).toContain('monad.md');
  });
});

// ── panes/hud.ts dedupe (M5 dedupe addition) ─────────────────────────

describe('panes/hud setSegment · M5 dedupe', () => {
  test('identical value+priority repeats do not fire subscriber', () => {
    const hud = createHud();
    let count = 0;
    subscribe(hud, () => { count += 1; });
    setSegment(hud, 'reasoning', 'X', 4);
    setSegment(hud, 'reasoning', 'X', 4);
    setSegment(hud, 'reasoning', 'X', 4);
    expect(count).toBe(1);
  });

  test('value change fires subscriber', () => {
    const hud = createHud();
    let count = 0;
    subscribe(hud, () => { count += 1; });
    setSegment(hud, 'reasoning', 'X', 4);
    setSegment(hud, 'reasoning', 'Y', 4);
    expect(count).toBe(2);
  });

  test('priority change fires subscriber', () => {
    const hud = createHud();
    let count = 0;
    subscribe(hud, () => { count += 1; });
    setSegment(hud, 'reasoning', 'X', 4);
    setSegment(hud, 'reasoning', 'X', 5);
    expect(count).toBe(2);
  });
});
