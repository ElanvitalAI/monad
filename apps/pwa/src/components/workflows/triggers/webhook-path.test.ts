// Surface-unification ROADMAP §B2 (2026-05-11) — webhook path validator.

import { describe, expect, it } from 'bun:test';
import { validateWebhookPath } from './WebhookTriggerEditor';

describe('validateWebhookPath', () => {
  it('accepts a well-formed path', () => {
    expect(validateWebhookPath('/hooks/deploy')).toEqual({ ok: true, message: 'path ok' });
  });

  it('rejects empty path', () => {
    expect(validateWebhookPath('')).toEqual({ ok: false, message: 'path required' });
    expect(validateWebhookPath('   ')).toEqual({ ok: false, message: 'path required' });
  });

  it('rejects path that does not start with /', () => {
    expect(validateWebhookPath('hooks/deploy')).toEqual({
      ok: false,
      message: "path must start with '/'",
    });
  });

  it('rejects whitespace inside path', () => {
    expect(validateWebhookPath('/hooks/deploy hook')).toEqual({
      ok: false,
      message: 'no whitespace in path',
    });
  });
});
