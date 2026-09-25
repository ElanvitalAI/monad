// Showroom v2 · 3-badge title formatter tests.
//
// Covers PLAN §D4 width-aware truncation:
//   Tier 1 full → Tier 2 drop transport → Tier 3 drop role
//   → Tier 4 truncate provider with ellipsis.

import { describe, test, expect } from 'bun:test';
import { formatLaneBadge } from '../src/showroom/badge-title.js';

describe('formatLaneBadge · full triple', () => {
  test('all 3 segments fit', () => {
    expect(formatLaneBadge({
      role: 'plan', provider: 'claude', transport: 'acp',
    })).toBe('plan · claude · acp');
  });

  test('build · codex · pty', () => {
    expect(formatLaneBadge({
      role: 'build', provider: 'codex', transport: 'pty',
    })).toBe('build · codex · pty');
  });
});

describe('formatLaneBadge · partial', () => {
  test('no role · provider only', () => {
    expect(formatLaneBadge({ provider: 'codex' })).toBe('codex');
  });

  test('no role · provider + transport', () => {
    expect(formatLaneBadge({ provider: 'codex', transport: 'acp' }))
      .toBe('codex · acp');
  });

  test('role + provider · no transport', () => {
    expect(formatLaneBadge({ role: 'review', provider: 'gemini' }))
      .toBe('review · gemini');
  });
});

describe('formatLaneBadge · width truncation', () => {
  test('drops transport when full exceeds maxWidth', () => {
    // 'plan · claude · acp' = 19 chars · drop transport →
    // 'plan · claude' = 13 chars
    const r = formatLaneBadge(
      { role: 'plan', provider: 'claude', transport: 'acp' },
      14,
    );
    expect(r).toBe('plan · claude');
  });

  test('drops role next when noTransport still too long', () => {
    // 'review · gemini' = 15 chars · maxWidth = 10 → drop role →
    // 'gemini' = 6 chars
    const r = formatLaneBadge(
      { role: 'review', provider: 'gemini', transport: 'auto' },
      10,
    );
    expect(r).toBe('gemini');
  });

  test('truncates provider with ellipsis when even bare provider too long', () => {
    const r = formatLaneBadge(
      { role: 'reflect', provider: 'verylongprovidername', transport: 'pty' },
      6,
    );
    expect(r).toBe('veryl…');
  });

  test('extreme tight width', () => {
    expect(formatLaneBadge({ provider: 'codex' }, 1)).toBe('…');
  });

  test('soft default budget = 24 fits common badges', () => {
    expect(formatLaneBadge({
      role: 'plan', provider: 'claude', transport: 'acp',
    })).toBe('plan · claude · acp');
  });
});

describe('formatLaneBadge · edge cases', () => {
  test('empty provider returns sentinel', () => {
    expect(formatLaneBadge({ provider: '' })).toBe('?');
  });

  test('whitespace provider treated as empty', () => {
    expect(formatLaneBadge({ provider: '   ' })).toBe('?');
  });

  test('local-llm provider with model preserved', () => {
    expect(formatLaneBadge({
      role: 'build', provider: 'lll:llama3', transport: 'pty',
    })).toBe('build · lll:llama3 · pty');
  });

  test('auto transport rendered verbatim', () => {
    expect(formatLaneBadge({
      role: 'plan', provider: 'claude', transport: 'auto',
    })).toBe('plan · claude · auto');
  });
});
