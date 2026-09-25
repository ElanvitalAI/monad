// PLAN-multi-surface-pty-shell M1 — buildTerminalCapableTurn contract.
//
// Locks the four terminal adapters the telegram surface proved, now
// promoted to the shared layer every self-turn surface consumes:
//   ① PTY_BUDGET_GRANT folded into llmOpts (existing llmOpts preserved)
//   ② abort signal → killNonDetached() (registry spy)
//   ③ `_imageFile` tool results → fileSink.sendImage, LLM sees text only
//   ④ TERMINAL_MISSION_DISCIPLINE appended to systemPromptParts

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as registry from '../src/pty-shell/registry.js';
import {
  buildTerminalCapableTurn,
  PTY_BUDGET_GRANT,
  TERMINAL_MISSION_DISCIPLINE,
} from '../src/agent/terminal-surface.js';

afterEach(() => {
  mock.restore();
});

const base = () => ({
  specs: [{ name: 'echo', description: 'echo', parameters: { type: 'object' as const, properties: {} } }],
  dispatch: async () => 'plain-result' as unknown,
  systemPromptParts: ['[part-a]', '[part-b]'],
});

describe('buildTerminalCapableTurn', () => {
  test('① folds PTY_BUDGET_GRANT into llmOpts, preserving caller opts', () => {
    const turn = buildTerminalCapableTurn({ ...base(), llmOpts: { model: 'gpt-5.6-terra' } });
    expect(turn.llmOpts.budgetGrant).toEqual(PTY_BUDGET_GRANT);
    expect(turn.llmOpts.model).toBe('gpt-5.6-terra');
    // absent llmOpts still yields the grant
    expect(buildTerminalCapableTurn(base()).llmOpts.budgetGrant).toEqual(PTY_BUDGET_GRANT);
  });

  test('② abort → killNonDetached, once, fail-soft', () => {
    const spy = spyOn(registry, 'killNonDetached').mockImplementation(() => 0);
    const ctrl = new AbortController();
    buildTerminalCapableTurn({ ...base(), signal: ctrl.signal });
    expect(spy).not.toHaveBeenCalled();
    ctrl.abort();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('② no signal ⇒ no cancel wiring (no throw)', () => {
    expect(() => buildTerminalCapableTurn(base())).not.toThrow();
  });

  test('③ _imageFile result → sendImage + text-only return', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'term-surface-'));
    try {
      const png = join(dir, 'shot.png');
      writeFileSync(png, Buffer.from('fake-png'));
      const sent: Array<{ len: number; caption?: string }> = [];
      const turn = buildTerminalCapableTurn({
        ...base(),
        dispatch: async () => ({ output: 'screen text', _imageFile: png, _imageCaption: 'cap' }),
        fileSink: {
          sendFile: () => {},
          sendImage: (buf, opts) => { sent.push({ len: buf.length, ...(opts?.caption ? { caption: opts.caption } : {}) }); },
        },
      });
      const result = await turn.dispatch('PtyShellScreenshot', {});
      expect(result).toEqual({ output: 'screen text' }); // pointer stripped from LLM view
      expect(sent).toEqual([{ len: 8, caption: 'cap' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('③ missing sink / unreadable file stays fail-soft, text preserved', async () => {
    const noSink = buildTerminalCapableTurn({
      ...base(),
      dispatch: async () => ({ output: 'txt', _imageFile: '/nope/missing.png' }),
    });
    expect(await noSink.dispatch('x', {})).toEqual({ output: 'txt' });

    const badFile = buildTerminalCapableTurn({
      ...base(),
      dispatch: async () => ({ _imageFile: '/nope/missing.png' }),
      fileSink: { sendFile: () => {}, sendImage: () => { throw new Error('boom'); } },
    });
    expect(await badFile.dispatch('x', {})).toEqual({ output: 'Screen captured.' });
  });

  test('③ inlineImages (daemon path) converts _imageFile to {mediaType,dataB64}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'term-surface-'));
    try {
      const png = join(dir, 'shot.png');
      writeFileSync(png, Buffer.from('fake-png'));
      const turn = buildTerminalCapableTurn({
        ...base(),
        dispatch: async () => ({ output: 'screen text', _imageFile: png }),
        inlineImages: true,
      });
      expect(await turn.dispatch('PtyShellScreenshot', {})).toEqual({
        output: 'screen text',
        mediaType: 'image/png',
        dataB64: Buffer.from('fake-png').toString('base64'),
      });
      // fileSink wins over inline when both are present (chat channels
      // render the attachment; no double delivery)
      const sent: number[] = [];
      const both = buildTerminalCapableTurn({
        ...base(),
        dispatch: async () => ({ output: 'screen text', _imageFile: png }),
        inlineImages: true,
        fileSink: { sendFile: () => {}, sendImage: (buf) => { sent.push(buf.length); } },
      });
      expect(await both.dispatch('PtyShellScreenshot', {})).toEqual({ output: 'screen text' });
      expect(sent).toEqual([8]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('③ inlineImages unreadable file falls back to text-only', async () => {
    const turn = buildTerminalCapableTurn({
      ...base(),
      dispatch: async () => ({ output: 'txt', _imageFile: '/nope/missing.png' }),
      inlineImages: true,
    });
    expect(await turn.dispatch('x', {})).toEqual({ output: 'txt' });
  });

  test('③ non-image results pass through untouched', async () => {
    const turn = buildTerminalCapableTurn(base());
    expect(await turn.dispatch('echo', {})).toBe('plain-result');
  });

  test('④ appends TERMINAL_MISSION_DISCIPLINE after caller parts; specs verbatim', () => {
    const b = base();
    const turn = buildTerminalCapableTurn(b);
    expect(turn.systemPromptParts).toEqual(['[part-a]', '[part-b]', TERMINAL_MISSION_DISCIPLINE]);
    expect(TERMINAL_MISSION_DISCIPLINE).toContain('[터미널 미션 규율]');
    expect(TERMINAL_MISSION_DISCIPLINE).toContain('PtyShellScreenshot');
    expect(turn.specs).toBe(b.specs);
  });
});
