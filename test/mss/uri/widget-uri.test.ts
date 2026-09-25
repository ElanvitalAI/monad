// ── WidgetUri brand tests (MSS M1.2 sub-PR #E) ──
//
// `WidgetInstance.id` (e.g. `skills-1`, `chart-px`) is a layout-host
// bookkeeping slug and stays a plain string (DD-MSS-38 wire boundary).
// `WidgetUri` brands the live instance — each spawn mints one so MSS
// bridges can attribute events to a specific instance lifetime.

import { describe, expect, test } from 'bun:test';

import { asWidgetUri, mintWidgetUri, newMonadUri } from '../../../src/mss/uri/builder.ts';
import { parseMonadUri } from '../../../src/mss/uri/parser.ts';

describe('mintWidgetUri', () => {
  test('returns a Tier 2 `widget/<ULID>` MonadUri', () => {
    const uri = mintWidgetUri();
    expect(uri).toMatch(/^widget\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct URIs (per-spawn identity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintWidgetUri() as string);
    expect(seen.size).toBe(50);
  });

  test('round-trips through asWidgetUri', () => {
    const uri = mintWidgetUri();
    expect(() => asWidgetUri(uri)).not.toThrow();
  });
});

describe('asWidgetUri', () => {
  test('accepts a fresh `widget/<ULID>` MonadUri', () => {
    const uri = newMonadUri('widget');
    expect(() => asWidgetUri(uri)).not.toThrow();
  });

  test('accepts a nested MonadUri whose path includes a widget segment', () => {
    const session = newMonadUri('session');
    const withWidget = newMonadUri('widget', session);
    expect(() => asWidgetUri(withWidget)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asWidgetUri('not-a-uri')).toThrow(/Invalid WidgetUri/);
  });

  test('rejects MonadUri without any widget segment', () => {
    const session = newMonadUri('session');
    expect(() => asWidgetUri(session)).toThrow(/Invalid WidgetUri/);
  });

  test('parsed URI surfaces the widget segment', () => {
    const uri = mintWidgetUri();
    const parsed = parseMonadUri(uri);
    expect(parsed?.segments[0]?.kind).toBe('widget');
  });
});
