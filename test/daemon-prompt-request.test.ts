import { describe, expect, it } from 'bun:test';

import { parseDaemonPromptBody } from '../src/boot/daemon-prompt-request.js';

describe('parseDaemonPromptBody', () => {
  it('rejects when both userText and userContent are missing', () => {
    const parsed = parseDaemonPromptBody({}, undefined);
    expect(parsed).toEqual({ ok: false, reason: 'userText or userContent required' });
  });

  it('rejects invalid source kind', () => {
    const parsed = parseDaemonPromptBody(
      { userText: 'hello', source: { kind: 'bad-kind' } as never },
      undefined,
    );
    expect(parsed).toEqual({
      ok: false,
      reason: 'source.kind must be a valid input source kind',
    });
  });

  it('builds session and effective prompt for valid source-aware request', () => {
    const parsed = parseDaemonPromptBody(
      {
        sessionId: 'sess-1',
        userText: 'hello',
        source: {
          kind: 'discord',
          family: 'communication',
          provider: 'discord',
          channelId: 'c-1',
          entry: 'text',
          relay: 'native-bot',
        },
      },
      'Base prompt',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sessionId).toBe('sess-1');
    expect(parsed.value.userText).toBe('hello');
    expect(parsed.value.userContent).toBeNull();
    expect(parsed.value.source).toEqual({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      channelId: 'c-1',
      entry: 'text',
      relay: 'native-bot',
    });
    expect(parsed.value.effectiveSystemPrompt).toContain('Base prompt');
    expect(parsed.value.effectiveSystemPrompt).toContain('Input source kind: discord');
  });

  // P-3 §6.9 (2026-05-07) — multi-part user content acceptance.
  describe('userContent (multi-part)', () => {
    it('accepts userContent with image + text and lifts userText from text block', () => {
      const parsed = parseDaemonPromptBody(
        {
          sessionId: 'sess-2',
          userContent: [
            { type: 'text', text: 'describe this' },
            { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo' },
          ],
        },
        undefined,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.userText).toBe('describe this');
      expect(parsed.value.userContent).toEqual([
        { type: 'text', text: 'describe this' },
        { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo' },
      ]);
    });

    it('accepts image-only userContent (no text block) — userText falls back to empty', () => {
      const parsed = parseDaemonPromptBody(
        {
          userContent: [
            { type: 'image', mimeType: 'image/jpeg', data: 'A' },
          ],
        },
        undefined,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.userText).toBe('');
      expect(parsed.value.userContent?.length).toBe(1);
    });

    it('rejects userContent items missing a type string', () => {
      const parsed = parseDaemonPromptBody(
        { userContent: [{ notAType: true } as never] },
        undefined,
      );
      expect(parsed).toEqual({
        ok: false,
        reason: 'userContent items must be ContentBlock objects with a type string',
      });
    });

    it('treats empty userContent array like absent (falls back to userText required)', () => {
      const parsed = parseDaemonPromptBody({ userContent: [] }, undefined);
      expect(parsed).toEqual({ ok: false, reason: 'userText or userContent required' });
    });

    it('userText wins over lifted text when both are provided', () => {
      const parsed = parseDaemonPromptBody(
        {
          userText: 'explicit',
          userContent: [{ type: 'text', text: 'lifted' }],
        },
        undefined,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.userText).toBe('explicit');
      expect(parsed.value.userContent?.length).toBe(1);
    });
  });

  // PR-D (PWA surface picker · 2026-05-13) — per-request tool-surface
  // override. Validates that good kinds pass through and bad strings
  // reject with a 400-shaped error.
  describe('tools (per-request surface override)', () => {
    it('omitted tools field carries through as null', () => {
      const parsed = parseDaemonPromptBody({ userText: 'hi' }, undefined);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.tools).toBeNull();
    });

    it.each(['none', 'readonly', 'chat', 'webterm'] as const)(
      'accepts %s as a valid surface kind',
      (kind) => {
        const parsed = parseDaemonPromptBody({ userText: 'hi', tools: kind }, undefined);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.tools).toBe(kind);
      },
    );

    it('rejects an unknown surface kind', () => {
      const parsed = parseDaemonPromptBody(
        { userText: 'hi', tools: 'bogus' as never },
        undefined,
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.reason).toContain('tools must be one of');
    });

    it('rejects non-string tools field', () => {
      const parsed = parseDaemonPromptBody(
        { userText: 'hi', tools: 42 as never },
        undefined,
      );
      expect(parsed.ok).toBe(false);
    });
  });
});
