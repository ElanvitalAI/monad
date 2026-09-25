import { describe, expect, it } from 'bun:test';

import {
  buildMirroredMessage,
  countDroppedAttachments,
} from './dock-history-mirror';

describe('buildMirroredMessage', () => {
  it('formats a REPL command echo as a meta line with the canonical prefix', () => {
    const m = buildMirroredMessage({ kind: 'replCommand', line: ':capture' });
    expect(m.role).toBe('meta');
    expect(m.text).toBe('▸ REPL · :capture');
  });

  it('strips ANSI / CR from REPL output before mirroring', () => {
    const raw = '\x1B[31mERR\x1B[0m\r\nfailed\r\n';
    const m = buildMirroredMessage({ kind: 'replOutput', output: raw });
    expect(m.role).toBe('meta');
    expect(m.text).toBe('ERR\nfailed');
  });

  it('falls back to "(no output)" for empty REPL output', () => {
    const m = buildMirroredMessage({ kind: 'replOutput', output: '   \r\n' });
    expect(m.text).toBe('(no output)');
  });

  it('preserves agent markdown verbatim and tags provider + mirrored origin', () => {
    const m = buildMirroredMessage({
      kind: 'agentResult',
      markdown: '## hello\n\n- bullet',
      modelLabel: 'anthropic/claude-opus-4-7',
    });
    expect(m.role).toBe('assistant');
    expect(m.text).toBe('## hello\n\n- bullet');
    expect(m.meta).toEqual({
      provider: 'anthropic/claude-opus-4-7',
      mirrored: 'repl',
    });
  });

  it('synthesizes a free-form note as a plain meta line', () => {
    const m = buildMirroredMessage({ kind: 'note', text: 'switched provider' });
    expect(m.role).toBe('meta');
    expect(m.text).toBe('switched provider');
  });
});

describe('countDroppedAttachments', () => {
  it('counts entries missing a path', () => {
    expect(
      countDroppedAttachments([
        { path: '/tmp/a.png' },
        { path: '' },
        {},
        { path: '/tmp/b.png' },
      ]),
    ).toBe(2);
  });

  it('returns 0 for an empty array', () => {
    expect(countDroppedAttachments([])).toBe(0);
  });

  it('treats whitespace-only path as missing', () => {
    // The current rule is "non-empty string"; daemon-side normalizer
    // doesn't trim. Keep them in sync — whitespace-only becomes drop.
    expect(countDroppedAttachments([{ path: ' ' }])).toBe(0);
  });
});
