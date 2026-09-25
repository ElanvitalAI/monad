// ── Capture Phase 0 — asciicast encoder tests ──

import { describe, expect, test } from 'bun:test';

import {
  asciicastFrame,
  asciicastHeader,
  decodeAsciicast,
  encodeAsciicast,
} from '../../src/capture/index.js';

describe('asciicastHeader', () => {
  test('basic header includes version + width + height + timestamp', () => {
    const out = asciicastHeader({ width: 80, height: 24, timestamp: 1700 });
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(2);
    expect(parsed.width).toBe(80);
    expect(parsed.height).toBe(24);
    expect(parsed.timestamp).toBe(1700);
    expect(parsed.title).toBeUndefined();
    expect(parsed.env).toBeUndefined();
  });

  test('title embeds when set', () => {
    const parsed = JSON.parse(asciicastHeader({
      width: 1, height: 1, timestamp: 0, title: 'demo',
    }));
    expect(parsed.title).toBe('demo');
  });

  test('env embeds when non-empty', () => {
    const parsed = JSON.parse(asciicastHeader({
      width: 1, height: 1, timestamp: 0, env: { SHELL: '/bin/bash', TERM: 'xterm-256color' },
    }));
    expect(parsed.env).toEqual({ SHELL: '/bin/bash', TERM: 'xterm-256color' });
  });

  test('empty env object omitted', () => {
    const parsed = JSON.parse(asciicastHeader({
      width: 1, height: 1, timestamp: 0, env: {},
    }));
    expect(parsed.env).toBeUndefined();
  });

  test('negative timestamp clamped to 0', () => {
    const parsed = JSON.parse(asciicastHeader({
      width: 1, height: 1, timestamp: -99,
    }));
    expect(parsed.timestamp).toBe(0);
  });
});

describe('asciicastFrame', () => {
  test('rounds time to microseconds', () => {
    const out = asciicastFrame({ time: 0.123456789, stream: 'o', data: 'x' });
    const arr = JSON.parse(out);
    expect(arr[0]).toBe(0.123457);
  });

  test('clamps negative time to 0', () => {
    const arr = JSON.parse(asciicastFrame({ time: -0.1, stream: 'o', data: '' }));
    expect(arr[0]).toBe(0);
  });

  test('stream and data round-trip', () => {
    const arr = JSON.parse(asciicastFrame({ time: 1.5, stream: 'i', data: 'keypress' }));
    expect(arr).toEqual([1.5, 'i', 'keypress']);
  });
});

describe('encodeAsciicast + decodeAsciicast round-trip', () => {
  test('two frames survive encode/decode', () => {
    const body = encodeAsciicast({
      dims: { cols: 80, rows: 24 },
      startedAtSec: 1700,
      title: 'rt',
      frames: [
        { time: 0, stream: 'o', data: 'hi' },
        { time: 0.5, stream: 'o', data: '\nbye\n' },
      ],
    });
    const { header, frames } = decodeAsciicast(body);
    expect(header.width).toBe(80);
    expect(header.title).toBe('rt');
    expect(frames).toEqual([
      { time: 0, stream: 'o', data: 'hi' },
      { time: 0.5, stream: 'o', data: '\nbye\n' },
    ]);
  });

  test('trailing newline after last frame', () => {
    const body = encodeAsciicast({
      dims: { cols: 1, rows: 1 },
      startedAtSec: 0,
      frames: [{ time: 0, stream: 'o', data: '' }],
    });
    expect(body.endsWith('\n')).toBe(true);
  });

  test('tolerates blank lines on decode', () => {
    const body = [
      asciicastHeader({ width: 1, height: 1, timestamp: 0 }),
      '',
      asciicastFrame({ time: 0, stream: 'o', data: 'x' }),
      '',
    ].join('\n');
    const { frames } = decodeAsciicast(body);
    expect(frames).toHaveLength(1);
  });

  test('rejects version != 2', () => {
    const bad = JSON.stringify({ version: 1, width: 80, height: 24, timestamp: 0 }) + '\n';
    expect(() => decodeAsciicast(bad)).toThrow(/version/);
  });

  test('rejects malformed frame', () => {
    const bad = asciicastHeader({ width: 1, height: 1, timestamp: 0 })
      + '\n' + JSON.stringify([0, 'o']);
    expect(() => decodeAsciicast(bad)).toThrow(/frame/);
  });
});
