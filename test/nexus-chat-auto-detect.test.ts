// NEXUS · chat backend auto-detection (N-1 cleanup PR g.1) — unit tests.
//
// Pin the priority order documented at the top of auto-detect.ts:
//   1. Codex OAuth      → 'codex'
//   2. OPENAI_API_KEY   → 'codex'
//   3. ANTHROPIC_API_KEY → 'claude-code'
//   4. GEMINI / GOOGLE_API_KEY → 'gemini'
//   (none) → 'none'
//
// Every test injects both `envSource` + `tokenLookup` so detection is
// deterministic without leaking host secrets.

import { describe, expect, test } from 'bun:test';

import { detectChatBackend } from '../src/nexus/chat/auto-detect.js';

const noTokens = (): null => null;

describe('detectChatBackend · priority', () => {
  test('codex OAuth wins over every API key', () => {
    const out = detectChatBackend({
      envSource: {
        OPENAI_API_KEY: 'sk-x',
        ANTHROPIC_API_KEY: 'sk-y',
        GEMINI_API_KEY: 'AI-z',
      },
      tokenLookup: (p) => (p === 'openai-codex' ? { tokens: { accessToken: 'oauth' } } : null),
    });
    expect(out.backend).toBe('codex');
    expect(out.source).toContain('OAuth');
  });

  test('OPENAI_API_KEY wins over ANTHROPIC + GEMINI when no OAuth', () => {
    const out = detectChatBackend({
      envSource: {
        OPENAI_API_KEY: 'sk-x',
        ANTHROPIC_API_KEY: 'sk-y',
        GEMINI_API_KEY: 'AI-z',
      },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('codex');
    expect(out.source).toContain('OPENAI_API_KEY');
  });

  test('ANTHROPIC_API_KEY wins over GEMINI when no OAuth + no OPENAI', () => {
    const out = detectChatBackend({
      envSource: {
        ANTHROPIC_API_KEY: 'sk-y',
        GEMINI_API_KEY: 'AI-z',
      },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('claude-code');
    expect(out.source).toContain('ANTHROPIC_API_KEY');
  });

  test('GEMINI_API_KEY → gemini when nothing else present', () => {
    const out = detectChatBackend({
      envSource: { GEMINI_API_KEY: 'AI-z' },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('gemini');
    expect(out.source).toContain('GEMINI_API_KEY');
  });

  test('GOOGLE_API_KEY also resolves to gemini (alternate env)', () => {
    const out = detectChatBackend({
      envSource: { GOOGLE_API_KEY: 'AI-z' },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('gemini');
    expect(out.source).toContain('GOOGLE_API_KEY');
  });

  test('nothing present → "none" + empty source', () => {
    const out = detectChatBackend({
      envSource: {},
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('none');
    expect(out.source).toBe('');
  });
});

describe('detectChatBackend · empty / whitespace handling', () => {
  test('empty-string env values do not count as set', () => {
    const out = detectChatBackend({
      envSource: { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '   ' },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('none');
  });

  test('non-string env values are ignored (process.env can pass undefined)', () => {
    const out = detectChatBackend({
      envSource: { OPENAI_API_KEY: undefined as unknown as string },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('none');
  });
});

describe('detectChatBackend · Grok / Cohere / etc not in priority', () => {
  test('XAI_API_KEY does not trigger auto-wire (Grok is daemon-only)', () => {
    const out = detectChatBackend({
      envSource: { XAI_API_KEY: 'xai-z' },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('none');
  });

  test('GROK_API_KEY does not trigger auto-wire either', () => {
    const out = detectChatBackend({
      envSource: { GROK_API_KEY: 'xai-z' },
      tokenLookup: noTokens,
    });
    expect(out.backend).toBe('none');
  });
});
