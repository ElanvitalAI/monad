// ── ModalUri brand tests (MSS M1.2 sub-PR #F) ──
//
// `ModalHandle.id` is `<typeName>#g<generation>` — the coordinator's
// bookkeeping key. `ModalUri` brands the same push with a typed
// handle so MSS bridges stay strongly-typed across the boundary.

import { describe, expect, test } from 'bun:test';

import { asModalUri, mintModalUri, newElanousUri } from '../../../src/mss/uri/builder.ts';
import { parseElanousUri } from '../../../src/mss/uri/parser.ts';

describe('mintModalUri', () => {
  test('returns a Tier 2 `modal/<ULID>` ElanousUri', () => {
    const uri = mintModalUri();
    expect(uri).toMatch(/^modal\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct URIs (per-push identity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintModalUri() as string);
    expect(seen.size).toBe(50);
  });

  test('round-trips through asModalUri', () => {
    const uri = mintModalUri();
    expect(() => asModalUri(uri)).not.toThrow();
  });
});

describe('asModalUri', () => {
  test('accepts a fresh `modal/<ULID>` ElanousUri', () => {
    const uri = newElanousUri('modal');
    expect(() => asModalUri(uri)).not.toThrow();
  });

  test('accepts a nested ElanousUri whose path includes a modal segment', () => {
    const session = newElanousUri('session');
    const withModal = newElanousUri('modal', session);
    expect(() => asModalUri(withModal)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asModalUri('not-a-uri')).toThrow(/Invalid ModalUri/);
  });

  test('rejects ElanousUri without any modal segment', () => {
    const session = newElanousUri('session');
    expect(() => asModalUri(session)).toThrow(/Invalid ModalUri/);
  });

  test('parsed URI surfaces the modal segment', () => {
    const uri = mintModalUri();
    const parsed = parseElanousUri(uri);
    expect(parsed?.segments[0]?.kind).toBe('modal');
  });
});
