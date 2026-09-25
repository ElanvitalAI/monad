// ── mintSessionUri tests (MSS M1.1 Phase B1) ──

import { describe, expect, test } from 'bun:test';

import { parseMonadUri } from '../../../src/mss/uri/parser.ts';
import { mintSessionUri } from '../../../src/mss/uri/session-mint.ts';
import { asSessionUri } from '../../../src/mss/uri/builder.ts';

describe('mintSessionUri', () => {
  test('returns a value that passes asSessionUri validation', () => {
    const uri = mintSessionUri();
    expect(() => asSessionUri(uri)).not.toThrow();
  });

  test('format is `session/<ULID>` — Tier 2 MonadUri', () => {
    const uri = mintSessionUri();
    expect(uri).toMatch(/^session\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('parses as a MonadUri with a single session segment', () => {
    const uri = mintSessionUri();
    const parsed = parseMonadUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.tier).toBe(2);
    expect(parsed!.segments.length).toBe(1);
    expect(parsed!.segments[0]!.kind).toBe('session');
  });

  test('successive mints yield distinct URIs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintSessionUri() as string);
    expect(seen.size).toBe(50);
  });

  test('ULID prefix is monotonic across millisecond boundaries', async () => {
    const a = mintSessionUri();
    await new Promise<void>((r) => setTimeout(r, 2));
    const b = mintSessionUri();
    // ULID timestamp prefix is the first 10 chars (48 bits · Crockford base32)
    const tsA = (a as string).split('/')[1]!.slice(0, 10);
    const tsB = (b as string).split('/')[1]!.slice(0, 10);
    expect(tsB.localeCompare(tsA)).toBeGreaterThan(0);
  });

  test('typed SessionUri can be used anywhere a MonadUri is expected', () => {
    const uri = mintSessionUri();
    // Compile-only smoke: no runtime assertion required — if this
    // compiles, the brand hierarchy is intact (SessionUri extends
    // MonadUri extends string).
    const asStr: string = uri;
    expect(typeof asStr).toBe('string');
  });
});
