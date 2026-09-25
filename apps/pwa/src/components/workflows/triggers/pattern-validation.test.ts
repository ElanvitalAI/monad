// Surface-unification ROADMAP §B4 (2026-05-11) — regex pattern validator
// shared between Discord and Telegram trigger forms.

import { describe, expect, it } from 'bun:test';
import { validatePattern } from './DiscordTriggerEditor';

describe('validatePattern', () => {
  it('accepts empty pattern as no-filter', () => {
    expect(validatePattern('')).toEqual({ ok: true, message: 'no filter' });
  });

  it('accepts valid regex expressions', () => {
    expect(validatePattern('^deploy')).toEqual({ ok: true, message: 'pattern ok' });
    expect(validatePattern('build|test')).toEqual({ ok: true, message: 'pattern ok' });
    expect(validatePattern('.*')).toEqual({ ok: true, message: 'pattern ok' });
  });

  it('rejects unbalanced regex characters', () => {
    expect(validatePattern('[unclosed').ok).toBe(false);
    expect(validatePattern('(unbalanced').ok).toBe(false);
  });
});
