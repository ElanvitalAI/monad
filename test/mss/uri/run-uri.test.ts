// ── RunUri brand tests (MSS M1.2 sub-PR #B) ──
//
// RunUri is a `ElanousUri` subtype — runs are fresh-from-scratch entities
// with no legacy wire format, so the canonical Tier 2 `run/<ULID>` shape
// is enforced from day one.

import { describe, expect, test } from 'bun:test';

import { asRunUri, mintRunUri, newElanousUri } from '../../../src/mss/uri/builder.ts';
import { parseElanousUri } from '../../../src/mss/uri/parser.ts';

describe('mintRunUri', () => {
  test('returns a Tier 2 `run/<ULID>` ElanousUri', () => {
    const uri = mintRunUri();
    expect(uri).toMatch(/^run\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct URIs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintRunUri() as string);
    expect(seen.size).toBe(50);
  });

  test('minted value parses as a single-segment run ElanousUri', () => {
    const uri = mintRunUri();
    const parsed = parseElanousUri(uri);
    expect(parsed?.tier).toBe(2);
    expect(parsed?.segments[0]?.kind).toBe('run');
  });
});

describe('asRunUri', () => {
  test('accepts a fresh `run/<ULID>` ElanousUri', () => {
    const uri = newElanousUri('run');
    expect(() => asRunUri(uri)).not.toThrow();
  });

  test('accepts a nested ElanousUri whose path includes a run segment', () => {
    const session = newElanousUri('session');
    const withRun = newElanousUri('run', session);
    expect(() => asRunUri(withRun)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asRunUri('not-a-uri')).toThrow(/Invalid RunUri/);
  });

  test('rejects ElanousUri without any run segment', () => {
    const session = newElanousUri('session');
    expect(() => asRunUri(session)).toThrow(/Invalid RunUri/);
  });

  test('rejects a bare ULID (RunUri requires the `run/` prefix)', () => {
    expect(() => asRunUri('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toThrow(/Invalid RunUri/);
  });
});
