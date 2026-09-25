// Surface-unification ROADMAP §B3 (2026-05-11) — HTTP URL validator.

import { describe, expect, it } from 'bun:test';
import { validateHttpUrl } from './HttpRequestEditor';

describe('validateHttpUrl', () => {
  it('accepts a fully-qualified https URL', () => {
    expect(validateHttpUrl('https://api.example.com/v1/items')).toEqual({
      ok: true,
      message: 'url ok',
    });
  });

  it('accepts an http URL', () => {
    expect(validateHttpUrl('http://localhost:8080/health')).toEqual({
      ok: true,
      message: 'url ok',
    });
  });

  it('rejects empty url', () => {
    expect(validateHttpUrl('')).toEqual({ ok: false, message: 'url required' });
    expect(validateHttpUrl('   ')).toEqual({ ok: false, message: 'url required' });
  });

  it('rejects unparseable url', () => {
    expect(validateHttpUrl('not a url')).toEqual({ ok: false, message: 'invalid URL' });
    expect(validateHttpUrl('://broken')).toEqual({ ok: false, message: 'invalid URL' });
  });
});
