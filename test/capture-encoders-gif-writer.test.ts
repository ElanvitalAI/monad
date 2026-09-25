// ── IUL Phase V·a — gif-writer (hand-rolled GIF89a) tests ──
//
// Verifies the writer produces a structurally correct GIF89a stream
// without depending on `sharp` rasterization. Validations:
//   - GIF89a header sniff
//   - Logical Screen Descriptor width/height bytes
//   - Global Color Table size flag (256-color)
//   - NETSCAPE 2.0 looping extension presence
//   - Per-frame Graphic Control Extension delay bytes
//   - Trailer byte (0x3b)
//
// These checks use byte offsets per the W3C GIF89a spec.

import { describe, expect, test } from 'bun:test';
import { writeAnimatedGif } from '../src/capture/encoders/gif-writer.js';

function solidRgba(w: number, h: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe('gif-writer · structural validity', () => {
  const w = 8, h = 4;
  const frames = [
    { rgba: solidRgba(w, h, 0, 0, 0), delayMs: 100 },
    { rgba: solidRgba(w, h, 255, 0, 0), delayMs: 100 },
  ];

  test('produces GIF89a header', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames });
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  });

  test('Logical Screen Descriptor encodes width/height (little-endian)', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames });
    expect(gif[6]).toBe(w & 0xff);
    expect(gif[7]).toBe((w >> 8) & 0xff);
    expect(gif[8]).toBe(h & 0xff);
    expect(gif[9]).toBe((h >> 8) & 0xff);
  });

  test('Global Color Table flag set, size = 256 entries', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames });
    // Packed byte: 0xf7 = GCT(1) + colorRes(7) + sort(0) + size(7→256).
    expect(gif[10]).toBe(0xf7);
  });

  test('GIF includes the NETSCAPE 2.0 looping extension', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames, loop: 0 });
    const idx = gif.indexOf(Buffer.from('NETSCAPE2.0'));
    expect(idx).toBeGreaterThan(0);
    // The next 4 bytes after NETSCAPE2.0 are: 0x03, 0x01, loopLo, loopHi
    expect(gif[idx + 11]).toBe(0x03);
    expect(gif[idx + 12]).toBe(0x01);
    expect(gif[idx + 13]).toBe(0x00); // loop=0 lo
    expect(gif[idx + 14]).toBe(0x00); // loop=0 hi
  });

  test('encodes loop count in NETSCAPE extension', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames, loop: 0x1234 });
    const idx = gif.indexOf(Buffer.from('NETSCAPE2.0'));
    expect(gif[idx + 13]).toBe(0x34);
    expect(gif[idx + 14]).toBe(0x12);
  });

  test('GraphicControlExt delay matches input (ms → 1/100s units)', () => {
    const f = [
      { rgba: solidRgba(w, h, 0, 0, 0), delayMs: 250 },
      { rgba: solidRgba(w, h, 0, 0, 0), delayMs: 500 },
    ];
    const gif = writeAnimatedGif({ width: w, height: h, frames: f });
    // GCE block: 0x21 0xf9 0x04 packed delayLo delayHi tIdx 0x00
    let cursor = 0;
    const delays: number[] = [];
    while (cursor < gif.length - 5) {
      if (gif[cursor] === 0x21 && gif[cursor + 1] === 0xf9 && gif[cursor + 2] === 0x04) {
        delays.push(gif[cursor + 4]! | (gif[cursor + 5]! << 8));
        cursor += 8;
      } else cursor++;
    }
    expect(delays).toEqual([25, 50]);
  });

  test('clamps delay floor to 2 (1/100s)', () => {
    const f = [
      { rgba: solidRgba(w, h, 0, 0, 0), delayMs: 5 },
      { rgba: solidRgba(w, h, 0, 0, 0), delayMs: 5 },
    ];
    const gif = writeAnimatedGif({ width: w, height: h, frames: f });
    // First GCE delay byte should be 2 (not 0 or 1).
    const idx = gif.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
    expect(idx).toBeGreaterThan(0);
    expect(gif[idx + 4]).toBe(2);
  });

  test('trailer byte 0x3b at end', () => {
    const gif = writeAnimatedGif({ width: w, height: h, frames });
    expect(gif[gif.length - 1]).toBe(0x3b);
  });

  test('throws on empty frame list', () => {
    expect(() => writeAnimatedGif({ width: w, height: h, frames: [] }))
      .toThrow(/no frames/);
  });

  test('throws when frame rgba length mismatches dims', () => {
    const bad = [
      { rgba: Buffer.alloc(10), delayMs: 100 },
    ];
    expect(() => writeAnimatedGif({ width: w, height: h, frames: bad }))
      .toThrow(/size/);
  });
});

describe('gif-writer · frame count vs file size', () => {
  test('more frames produce larger files (linear-ish)', () => {
    const w = 4, h = 4;
    const oneFrame = writeAnimatedGif({
      width: w, height: h,
      frames: [{ rgba: solidRgba(w, h, 0, 0, 0), delayMs: 100 }],
    });
    const tenFrames = writeAnimatedGif({
      width: w, height: h,
      frames: Array.from({ length: 10 }, () => ({
        rgba: solidRgba(w, h, 0, 0, 0), delayMs: 100,
      })),
    });
    expect(tenFrames.length).toBeGreaterThan(oneFrame.length);
  });
});
