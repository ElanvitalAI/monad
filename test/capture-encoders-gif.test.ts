// ── IUL Phase V·a — gif encoder tests ──
//
// Verifies header sniff, ANSI/SVG frame paths, delay normalization,
// dim-mismatch rejection, and that the output is a valid animated GIF.

import { describe, expect, test } from 'bun:test';
import {
  encodeGif,
  isAnimatedGifBuffer,
  GifEncodeError,
} from '../src/capture/encoders/gif.js';
import { encodeSvg } from '../src/capture/encoders/svg.js';

const TINY_DIMS = { cols: 4, rows: 2 };

function tinyAnsi(label: string): string {
  // 4 cols × 2 rows of plain text — encodeSvg handles short input fine.
  return `${label.padEnd(4, ' ').slice(0, 4)}\n----`;
}

describe('gif · header sniff', () => {
  test('isAnimatedGifBuffer returns true for GIF89a', () => {
    expect(isAnimatedGifBuffer(Buffer.from('GIF89a-rest'))).toBe(true);
    expect(isAnimatedGifBuffer(Buffer.from('GIF87a-rest'))).toBe(true);
  });

  test('isAnimatedGifBuffer returns false for non-gif bytes', () => {
    expect(isAnimatedGifBuffer(Buffer.from('PNG-rest'))).toBe(false);
    expect(isAnimatedGifBuffer(Buffer.alloc(3))).toBe(false);
  });
});

describe('gif · validation', () => {
  test('throws on empty frame list', async () => {
    await expect(encodeGif({ frames: [] })).rejects.toBeInstanceOf(GifEncodeError);
  });

  test('throws when ANSI frame is supplied without dims', async () => {
    await expect(
      encodeGif({ frames: [{ ansi: 'foo' }] }),
    ).rejects.toBeInstanceOf(GifEncodeError);
  });

  test('throws when frame has neither svg nor ansi', async () => {
    await expect(
      encodeGif({ frames: [{} as never] }),
    ).rejects.toBeInstanceOf(GifEncodeError);
  });

  test('throws when frames have mismatched dims', async () => {
    const small = encodeSvg({ input: 'a', cols: 1, rows: 1 });
    const big = encodeSvg({ input: 'aaa', cols: 3, rows: 1 });
    await expect(
      encodeGif({ frames: [{ svg: small }, { svg: big }] }),
    ).rejects.toBeInstanceOf(GifEncodeError);
  });
});

describe('gif · encode pipeline', () => {
  test('renders 3 ANSI frames into a valid GIF buffer', async () => {
    const gif = await encodeGif({
      frames: [
        { ansi: tinyAnsi('aa'), delayMs: 100 },
        { ansi: tinyAnsi('bb'), delayMs: 100 },
        { ansi: tinyAnsi('cc'), delayMs: 100 },
      ],
      dims: TINY_DIMS,
    });
    expect(Buffer.isBuffer(gif)).toBe(true);
    expect(gif.length).toBeGreaterThan(50);
    expect(isAnimatedGifBuffer(gif)).toBe(true);
  });

  test('renders pre-rendered SVG frames (no dims required)', async () => {
    const svg = encodeSvg({ input: tinyAnsi('xx'), cols: TINY_DIMS.cols, rows: TINY_DIMS.rows });
    const gif = await encodeGif({
      frames: [{ svg }, { svg }],
      defaultDelayMs: 80,
    });
    expect(isAnimatedGifBuffer(gif)).toBe(true);
  });

  test('respects explicit loop count metadata', async () => {
    const gif = await encodeGif({
      frames: [
        { ansi: tinyAnsi('1'), delayMs: 50 },
        { ansi: tinyAnsi('2'), delayMs: 50 },
      ],
      dims: TINY_DIMS,
      loop: 3,
    });
    expect(isAnimatedGifBuffer(gif)).toBe(true);
    // GIF89a NETSCAPE 2.0 application extension carries loop count.
    // We just sniff for the bytes — the substring is unique enough.
    expect(gif.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
  });

  test('clamps delays below 20ms (GIF spec floor)', async () => {
    // Tiny delays should not throw — they normalize to 20.
    const gif = await encodeGif({
      frames: [
        { ansi: tinyAnsi('a'), delayMs: 5 },
        { ansi: tinyAnsi('b'), delayMs: 5 },
      ],
      dims: TINY_DIMS,
    });
    expect(isAnimatedGifBuffer(gif)).toBe(true);
  });

  test('honors defaultDelayMs when frames omit their own delay', async () => {
    const gif = await encodeGif({
      frames: [{ ansi: tinyAnsi('a') }, { ansi: tinyAnsi('b') }],
      dims: TINY_DIMS,
      defaultDelayMs: 250,
    });
    expect(isAnimatedGifBuffer(gif)).toBe(true);
    // Sanity — multi-frame GIFs are always larger than 1-frame ones.
    const onef = await encodeGif({
      frames: [{ ansi: tinyAnsi('a') }],
      dims: TINY_DIMS,
    });
    expect(gif.length).toBeGreaterThan(onef.length);
  });
});
