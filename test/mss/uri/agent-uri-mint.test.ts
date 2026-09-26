// ── mintAgentUri tests (MSS M1.2 sub-PR #C) ──
//
// `AgentUri` itself was introduced in M1.0 (along with `asAgentUri`); M1.2
// adds the `mintAgentUri()` factory + wires it into `AgentRegistry.spawn()`
// so every live task carries a branded URI alongside its legacy UUID id.

import { describe, expect, test } from 'bun:test';

import { asAgentUri, mintAgentUri } from '../../../src/mss/uri/builder.ts';
import { parseElanousUri } from '../../../src/mss/uri/parser.ts';

describe('mintAgentUri', () => {
  test('returns a Tier 2 `agent/<ULID>` ElanousUri', () => {
    const uri = mintAgentUri();
    expect(uri).toMatch(/^agent\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('successive mints yield distinct URIs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(mintAgentUri() as string);
    expect(seen.size).toBe(50);
  });

  test('minted value parses as a single-segment agent ElanousUri', () => {
    const uri = mintAgentUri();
    const parsed = parseElanousUri(uri);
    expect(parsed?.tier).toBe(2);
    expect(parsed?.segments[0]?.kind).toBe('agent');
  });

  test('round-trips through asAgentUri without throwing', () => {
    const uri = mintAgentUri();
    expect(() => asAgentUri(uri)).not.toThrow();
  });

  test('typed AgentUri can be used anywhere a string is expected', () => {
    const uri = mintAgentUri();
    const asStr: string = uri;
    expect(typeof asStr).toBe('string');
  });
});
