/**
 * WT-S-1 envelope codec contract — `elanous/term/*` parser. Daemon-side
 * counterpart: `src/acp/elanous-extensions.ts` (두 copy 가 wire 정확히 같아야).
 *
 * 본 test 가 PWA-side 의 parse 분기를 wire 형식 변동 시 자동 회귀 차단.
 */

import { describe, expect, it } from 'bun:test';

import { parseElanousTermEnvelope } from './elanous-term-envelope';

function envelope(method: string, payload: unknown): string {
  const terminalId = (payload as { terminalId?: string }).terminalId ?? '';
  return [
    `[elanous/term/${method}] ${terminalId}`,
    JSON.stringify(payload),
    `<<elanous-term-end ${terminalId}>>`,
  ].join('\n');
}

describe('parseElanousTermEnvelope', () => {
  it('parses a terminalOutput frame', () => {
    const text = envelope('terminalOutput', { terminalId: 'term-1', data: 'hello' });
    const result = parseElanousTermEnvelope(text);
    expect(result).toEqual({
      method: 'terminalOutput',
      payload: { terminalId: 'term-1', data: 'hello' },
    });
  });

  it('parses a terminalExit frame with numeric code', () => {
    const text = envelope('terminalExit', { terminalId: 'term-1', code: 0 });
    const result = parseElanousTermEnvelope(text);
    expect(result).toEqual({
      method: 'terminalExit',
      payload: { terminalId: 'term-1', code: 0 },
    });
  });

  it('parses a terminalFrame snapshot (multi-row · picker/modal)', () => {
    const frame = '┌─ elanous ─┐\n│ /he    │\n│ picker │\n└────────┘';
    const text = envelope('terminalFrame', { terminalId: 'tui:9', frame, instance: 'test:x', at: 1717 });
    const result = parseElanousTermEnvelope(text);
    expect(result).toEqual({
      method: 'terminalFrame',
      payload: { terminalId: 'tui:9', frame, instance: 'test:x', at: 1717 },
    });
  });

  it('rejects a terminalFrame missing instance/at', () => {
    const text = envelope('terminalFrame', { terminalId: 'tui:9', frame: 'x' });
    expect(parseElanousTermEnvelope(text)).toBeNull();
  });

  it('parses a terminalInputActivity frame with peerId / timestamp / bytes', () => {
    const text = envelope('terminalInputActivity', {
      terminalId: 'term-1',
      peerId: 'abc12345',
      timestamp: 1_700_000_000_000,
      bytes: 4,
    });
    const result = parseElanousTermEnvelope(text);
    expect(result).toEqual({
      method: 'terminalInputActivity',
      payload: {
        terminalId: 'term-1',
        peerId: 'abc12345',
        timestamp: 1_700_000_000_000,
        bytes: 4,
      },
    });
  });

  it('returns null when the first line lacks the sentinel', () => {
    expect(parseElanousTermEnvelope('plain text')).toBeNull();
    expect(parseElanousTermEnvelope('')).toBeNull();
  });

  it('returns null on unknown method', () => {
    const text = `[elanous/term/unknownMethod] term-1\n{"terminalId":"term-1"}\n<<elanous-term-end term-1>>`;
    expect(parseElanousTermEnvelope(text)).toBeNull();
  });

  it('returns null on malformed JSON body', () => {
    const text = `[elanous/term/terminalOutput] term-1\n{not json\n<<elanous-term-end term-1>>`;
    expect(parseElanousTermEnvelope(text)).toBeNull();
  });

  it('returns null when terminalOutput is missing data', () => {
    const text = envelope('terminalOutput', { terminalId: 'term-1' });
    expect(parseElanousTermEnvelope(text)).toBeNull();
  });

  it('returns null when terminalExit code is non-numeric', () => {
    const text = envelope('terminalExit', { terminalId: 'term-1', code: '0' });
    expect(parseElanousTermEnvelope(text)).toBeNull();
  });

  it('returns null when terminalInputActivity is missing peerId / timestamp / bytes', () => {
    expect(parseElanousTermEnvelope(envelope('terminalInputActivity', {
      terminalId: 'term-1',
      timestamp: 1, bytes: 1,
    }))).toBeNull();
    expect(parseElanousTermEnvelope(envelope('terminalInputActivity', {
      terminalId: 'term-1', peerId: 'p',
      bytes: 1,
    }))).toBeNull();
  });

  it('preserves multi-line payload data (newlines inside JSON string)', () => {
    const payload = { terminalId: 'term-1', data: 'line1\nline2' };
    const text = envelope('terminalOutput', payload);
    const result = parseElanousTermEnvelope(text);
    expect(result?.payload).toEqual(payload);
  });
});
