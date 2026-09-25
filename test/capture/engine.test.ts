// ── Capture Phase 0 — engine entry tests ──

import { describe, expect, test } from 'bun:test';

import {
  capture,
  decodeAsciicast,
  type CaptureRequest,
} from '../../src/capture/index.js';

function req(over: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    target: { kind: 'stream' },
    format: 'text',
    dims: { cols: 80, rows: 24 },
    source: () => 'hello world\n',
    now: () => 1_700_000_000_000,
    ...over,
  };
}

describe('capture engine · text format', () => {
  test('strips SGR and motion sequences', () => {
    const result = capture(req({
      source: () => '\x1b[31mRED\x1b[0m plain\r\n',
      format: 'text',
    }));
    expect(result.format).toBe('text');
    expect(result.body).toContain('RED plain');
    expect(result.body).not.toContain('\x1b[');
  });

  test('byte length matches body', () => {
    const r = capture(req({ source: () => 'hi' }));
    expect(r.bytes).toBe(2);
  });

  test('capturedAt pulled from now()', () => {
    const r = capture(req({ now: () => 42 }));
    expect(r.capturedAt).toBe(42);
  });

  test('echoInput preserves original payload', () => {
    const r = capture(req({
      source: () => '\x1b[31mX\x1b[0m',
      echoInput: true,
    }));
    expect(r.input).toBe('\x1b[31mX\x1b[0m');
    expect(r.body).toBe('X');
  });
});

describe('capture engine · ansi format', () => {
  test('passes SGR through unchanged', () => {
    const input = '\x1b[32mgreen\x1b[0m';
    const r = capture(req({ format: 'ansi', source: () => input }));
    expect(r.body).toBe(input);
  });

  test('dims echo back', () => {
    const r = capture(req({
      format: 'ansi',
      dims: { cols: 120, rows: 40 },
      source: () => 'x',
    }));
    expect(r.dims).toEqual({ cols: 120, rows: 40 });
  });
});

describe('capture engine · asciicast format', () => {
  test('produces a decodable single-frame v2 cast', () => {
    const r = capture(req({
      format: 'asciicast',
      source: () => 'hello\r\n',
      title: 'test',
      now: () => 1_700_000_000_000,
    }));
    expect(r.format).toBe('asciicast');
    const { header, frames } = decodeAsciicast(r.body);
    expect(header.width).toBe(80);
    expect(header.height).toBe(24);
    expect(header.title).toBe('test');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.time).toBe(0);
    expect(frames[0]!.stream).toBe('o');
    expect(frames[0]!.data).toBe('hello\r\n');
  });

  test('timestamp uses floor(now/1000)', () => {
    const r = capture(req({
      format: 'asciicast',
      source: () => '',
      now: () => 1_699_999_999_999,  // just under 1_700_000_000s
    }));
    const { header } = decodeAsciicast(r.body);
    expect(header.timestamp).toBe(1_699_999_999);
  });
});

describe('capture engine · error paths', () => {
  test('source exceptions propagate', () => {
    expect(() => capture(req({
      source: () => { throw new Error('source boom'); },
    }))).toThrow('source boom');
  });
});
