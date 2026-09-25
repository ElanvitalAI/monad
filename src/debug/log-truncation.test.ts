import { describe, expect, test } from 'bun:test';
import { compactForLog, formatLine, redactSecrets, type DebugEvent } from './log.js';

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function expectSafeJson(value: string): void {
  const serialized = JSON.stringify(value);
  expect(hasUnpairedSurrogate(value)).toBe(false);
  expect(hasUnpairedSurrogate(serialized)).toBe(false);
  expect(JSON.parse(serialized)).toBe(value);
}

describe('UTF-16-safe debug-log truncation', () => {
  test('formatLine keeps its 397-unit payload prefix and ellipsis without a split emoji', () => {
    const payload = 'a'.repeat(395) + '😀' + 'tail';
    const legacy = JSON.stringify(payload).slice(0, 397) + '…';
    const line = formatLine({ ts: '2026-08-13T00:00:00.000Z', category: 'test', event: 'format', data: payload });
    const output = line.split('  ').at(-1)!;

    expect(payload.length).toBeGreaterThan(400);
    expect(hasUnpairedSurrogate(legacy)).toBe(true);
    expect(output).toBe(JSON.stringify(payload).slice(0, 396) + '…');
    expect(output.length).toBeLessThanOrEqual(398);
    expectSafeJson(output);
  });

  test('compactForLog keeps the default 256-unit prefix and marker without a split emoji', () => {
    const input = 'a'.repeat(255) + '😀' + 'tail';
    const legacy = input.slice(0, 256) + `«+${input.length - 256}c»`;
    const output = compactForLog(input);

    const preservedPrefix = 'a'.repeat(255);
    const omitted = input.length - preservedPrefix.length;

    expect(input.length).toBeGreaterThan(256);
    expect(hasUnpairedSurrogate(legacy)).toBe(true);
    expect(output).toBe(preservedPrefix + `«+${omitted}c»`);
    expect(output).toEndWith(`«+${omitted}c»`);
    expect(output.length).toBeLessThanOrEqual(256 + `«+${omitted}c»`.length);
    expectSafeJson(output);
  });

  test('redactSecrets keeps its first-four/last-four abbreviation and ellipsis without split emoji', () => {
    const secret = 'abc😀' + 'middle' + '😀xyz';
    const legacy = secret.slice(0, 4) + '…' + secret.slice(-4);
    const output = (redactSecrets({ authorization: secret }) as { authorization: string }).authorization;

    expect(secret.length).toBeGreaterThan(12);
    expect(hasUnpairedSurrogate(legacy)).toBe(true);
    expect(output).toBe('abc…xyz');
    expect(output.length).toBeLessThanOrEqual(9);
    expectSafeJson(output);
  });

  test('ordinary long strings retain the previous lengths and markers', () => {
    const payload = 'p'.repeat(401);
    const line = formatLine({ ts: '2026-08-13T00:00:00.000Z', category: 'test', event: 'ordinary', data: payload });
    const compact = compactForLog('c'.repeat(260));
    const redacted = (redactSecrets({ authorization: 'abcdefghijklmnop' }) as { authorization: string }).authorization;

    expect(line.split('  ').at(-1)).toBe(JSON.stringify(payload).slice(0, 397) + '…');
    expect(compact).toBe('c'.repeat(256) + '«+4c»');
    expect(redacted).toBe('abcd…mnop');
  });

  test('strings below every truncation threshold remain unchanged', () => {
    const event: DebugEvent = { ts: '2026-08-13T00:00:00.000Z', category: 'test', event: 'short', data: 'short' };
    const shortSecret = 'short';

    expect(formatLine(event).endsWith('"short"')).toBe(true);
    expect(compactForLog('short')).toBe('short');
    expect((redactSecrets({ authorization: shortSecret }) as { authorization: string }).authorization).toBe('<redacted>');
  });
});
