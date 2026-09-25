// ── PluginUri brand tests (MSS M1.2 sub-PR #D) ──
//
// The plugin manifest's `id` slug is a wire string (DD-MSS-38) and is
// not narrowed. `PluginUri` brands a *specific activation* — a fresh
// URI per activate() call so MSS bridges can attribute events to the
// activation cycle rather than the plugin definition.

import { describe, expect, test } from 'bun:test';

import { asPluginUri, mintPluginUri, newMonadUri } from '../../../src/mss/uri/builder.ts';
import { parseMonadUri } from '../../../src/mss/uri/parser.ts';

describe('mintPluginUri', () => {
  test('returns a Tier 2 `plugin/<ULID>` MonadUri', () => {
    const uri = mintPluginUri();
    expect(uri).toMatch(/^plugin\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct URIs (per-activation identity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintPluginUri() as string);
    expect(seen.size).toBe(50);
  });

  test('round-trips through asPluginUri', () => {
    const uri = mintPluginUri();
    expect(() => asPluginUri(uri)).not.toThrow();
  });
});

describe('asPluginUri', () => {
  test('accepts a fresh `plugin/<ULID>` MonadUri', () => {
    const uri = newMonadUri('plugin');
    expect(() => asPluginUri(uri)).not.toThrow();
  });

  test('accepts a nested MonadUri whose path includes a plugin segment', () => {
    const session = newMonadUri('session');
    const withPlugin = newMonadUri('plugin', session);
    expect(() => asPluginUri(withPlugin)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asPluginUri('not-a-uri')).toThrow(/Invalid PluginUri/);
  });

  test('rejects MonadUri without any plugin segment', () => {
    const session = newMonadUri('session');
    expect(() => asPluginUri(session)).toThrow(/Invalid PluginUri/);
  });

  test('parsed URI surfaces the plugin segment', () => {
    const uri = mintPluginUri();
    const parsed = parseMonadUri(uri);
    expect(parsed?.segments[0]?.kind).toBe('plugin');
  });
});
