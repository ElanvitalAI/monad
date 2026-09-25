// ── ModalUri brand tests (MSS M1.2 sub-PR #F) ──
//
// `ModalHandle.id` is `<typeName>#g<generation>` — the coordinator's
// bookkeeping key. `ModalUri` brands the same push with a typed
// handle so MSS bridges stay strongly-typed across the boundary.

import { describe, expect, test } from 'bun:test';

import { asModalUri, mintModalUri, newMonadUri } from '../../../src/mss/uri/builder.ts';
import { parseMonadUri } from '../../../src/mss/uri/parser.ts';

describe('mintModalUri', () => {
  test('returns a Tier 2 `modal/<ULID>` MonadUri', () => {
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
  test('accepts a fresh `modal/<ULID>` MonadUri', () => {
    const uri = newMonadUri('modal');
    expect(() => asModalUri(uri)).not.toThrow();
  });

  test('accepts a nested MonadUri whose path includes a modal segment', () => {
    const session = newMonadUri('session');
    const withModal = newMonadUri('modal', session);
    expect(() => asModalUri(withModal)).not.toThrow();
  });

  test('rejects garbage input', () => {
    expect(() => asModalUri('not-a-uri')).toThrow(/Invalid ModalUri/);
  });

  test('rejects MonadUri without any modal segment', () => {
    const session = newMonadUri('session');
    expect(() => asModalUri(session)).toThrow(/Invalid ModalUri/);
  });

  test('parsed URI surfaces the modal segment', () => {
    const uri = mintModalUri();
    const parsed = parseMonadUri(uri);
    expect(parsed?.segments[0]?.kind).toBe('modal');
  });
});
