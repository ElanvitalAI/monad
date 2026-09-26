// ── TurnUri brand tests (MSS M1.2 Sub-PR #A) ──
//
// TurnUri is a standalone ULID brand (not a ElanousUri subtype) so SAM S0's
// bare-ULID wire format stays identical across the M1.2 narrowing. The
// lenient `asTurnUri()` accepts both the bare form and the Tier 2
// `turn/<ULID>` ElanousUri segment; `mintTurnUri()` emits the bare form.

import { describe, expect, test } from 'bun:test';

import { asTurnUri, mintTurnUri, newElanousUri } from '../../../src/mss/uri/builder.ts';
import { parseElanousUri } from '../../../src/mss/uri/parser.ts';

describe('mintTurnUri', () => {
  test('returns a 26-char Crockford base32 ULID', () => {
    const uri = mintTurnUri();
    expect(uri).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintTurnUri() as string);
    expect(seen.size).toBe(50);
  });

  test('minted value round-trips through asTurnUri', () => {
    const uri = mintTurnUri();
    expect(() => asTurnUri(uri)).not.toThrow();
  });
});

describe('asTurnUri', () => {
  test('accepts bare ULID (SAM S0 wire format)', () => {
    const raw = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const branded = asTurnUri(raw);
    expect(branded as string).toBe(raw);
  });

  test('accepts Tier 2 `turn/<ULID>` ElanousUri segment', () => {
    const uri = newElanousUri('turn');
    expect(() => asTurnUri(uri)).not.toThrow();
    const parsed = parseElanousUri(uri);
    expect(parsed?.segments[0]?.kind).toBe('turn');
  });

  test('accepts nested ElanousUri that carries a turn segment', () => {
    const session = newElanousUri('session');
    const withTurn = newElanousUri('turn', session);
    expect(() => asTurnUri(withTurn)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asTurnUri('not-a-ulid')).toThrow(/Invalid TurnUri/);
    expect(() => asTurnUri('')).toThrow(/Invalid TurnUri/);
  });

  test('rejects ElanousUri without any turn segment', () => {
    const session = newElanousUri('session');
    expect(() => asTurnUri(session)).toThrow(/Invalid TurnUri/);
  });
});
