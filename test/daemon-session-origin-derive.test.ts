// P-1 — unit cover for `deriveOriginFromInputSourceKind`.
//
// The mapping is the foundation of cross-bridge origin tagging: every
// /v1/prompt[/stream] turn passes through it. A regression here would
// silently mis-tag every session in the picker, so each `InputSourceKind`
// gets an explicit assertion.

import { describe, expect, test } from 'bun:test';

import { deriveOriginFromInputSourceKind } from '../src/boot/daemon-session-origin-derive.js';
import type { InputSourceKind } from '../src/input/input-source-kind.js';

describe('deriveOriginFromInputSourceKind', () => {
  test('telegram → tg', () => {
    expect(deriveOriginFromInputSourceKind('telegram')).toBe('tg');
  });

  test('discord → dc', () => {
    expect(deriveOriginFromInputSourceKind('discord')).toBe('dc');
  });

  test('pwa → pwa', () => {
    expect(deriveOriginFromInputSourceKind('pwa')).toBe('pwa');
  });

  test('daemon-api → cli (TUI bare HTTP path)', () => {
    expect(deriveOriginFromInputSourceKind('daemon-api')).toBe('cli');
  });

  test('ACP-internal kinds stay untagged (undefined)', () => {
    const internal: InputSourceKind[] = [
      'keyboard', 'mouse', 'voice', 'browser', 'terminal',
      'scheduled', 'llm-tool', 'glass',
    ];
    for (const kind of internal) {
      expect(deriveOriginFromInputSourceKind(kind)).toBeUndefined();
    }
  });

  test('undefined input → undefined (caller-side missing source)', () => {
    expect(deriveOriginFromInputSourceKind(undefined)).toBeUndefined();
  });
});
