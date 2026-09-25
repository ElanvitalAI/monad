// Byte-level validation of the KGP encoder. We don't golden-dump
// against yazi (the base64 payload for a 2x2 image is identical
// between implementations, but the surrounding session-specific
// image-id differs) — instead we verify each invariant of the
// protocol output separately.

import { describe, test, expect } from 'bun:test';
import {
  uploadSequence,
  placeholderGrid,
  deleteSequence,
  deleteAllSequence,
  wrapForTmux,
  type ImageFrame,
} from '../../src/kgp/encoder.js';
import { DIACRITICS, PLACEHOLDER } from '../../src/kgp/diacritics.js';

function makeRGBA(w: number, h: number, colour: [number, number, number, number]): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4 + 0] = colour[0];
    buf[i * 4 + 1] = colour[1];
    buf[i * 4 + 2] = colour[2];
    buf[i * 4 + 3] = colour[3];
  }
  return buf;
}

describe('uploadSequence — APC framing', () => {
  const red2x2: ImageFrame = {
    data: makeRGBA(2, 2, [255, 0, 0, 255]),
    w: 2, h: 2, format: 32, imageId: 0xABCDEF,
  };

  test('starts with APC header', () => {
    const seq = uploadSequence(red2x2);
    expect(seq.startsWith('\x1b_G')).toBe(true);
  });

  test('ends with ST (\\x1b\\\\)', () => {
    const seq = uploadSequence(red2x2);
    expect(seq.endsWith('\x1b\\')).toBe(true);
  });

  test('header carries all required fields', () => {
    const seq = uploadSequence(red2x2);
    // Header is everything up to the first `;` after `_G`.
    const header = seq.slice(0, seq.indexOf(';'));
    expect(header).toContain('q=2');     // quiet
    expect(header).toContain('a=T');     // transmit
    expect(header).toContain('C=1');     // no cursor move
    expect(header).toContain('U=1');     // unicode-placeholder mode
    expect(header).toContain('f=32');    // RGBA
    expect(header).toContain('s=2');     // width
    expect(header).toContain('v=2');     // height
    expect(header).toContain('i=11259375'); // 0xABCDEF == 11259375
  });

  test('single chunk → m=0', () => {
    const seq = uploadSequence(red2x2);
    expect(seq).toContain('m=0;');
    // 2x2 RGBA = 16 bytes = 24 b64 chars — way under 4096, so no
    // continuation chunks.
    expect(seq.split('\x1b_G').length - 1).toBe(1);
  });

  test('multi-chunk image uses m=1 continuations', () => {
    // Force >4096 base64 chars: 4096 b64 chars = 3072 raw bytes → need ~3500 bytes of data.
    const big = makeRGBA(32, 32, [0, 255, 0, 255]); // 32*32*4 = 4096 raw → 5464 b64 chars → 2 chunks
    const seq = uploadSequence({ data: big, w: 32, h: 32, format: 32, imageId: 42 });
    // First chunk: m=1.
    expect(seq).toContain('m=1;');
    // Last chunk uses m=0 (closing).
    const lastG = seq.lastIndexOf('\x1b_G');
    expect(seq.slice(lastG)).toContain('m=0;');
    // At least 2 `\x1b_G` APC headers.
    expect(seq.split('\x1b_G').length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe('placeholderGrid — unicode-placeholder layout', () => {
  test('rows × cols cells, each with base + 2 diacritics', () => {
    const g = placeholderGrid({ rows: 3, cols: 4, imageId: 0x112233 });
    expect(g.length).toBe(3);
    for (const line of g) {
      // Strip SGR wrappers to count placeholder cells.
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
      // Each cell: U+10EEEE (2 UTF-16 code units) + 2 diacritics (1 each).
      expect(stripped.length).toBe(4 * (PLACEHOLDER.length + 2));
    }
  });

  test('row y uses DIACRITICS[y] as its row marker', () => {
    const g = placeholderGrid({ rows: 2, cols: 1, imageId: 0 });
    const row0Stripped = g[0].replace(/\x1b\[[0-9;]*m/g, '');
    const row1Stripped = g[1].replace(/\x1b\[[0-9;]*m/g, '');
    // row0: PLACEHOLDER + DIACRITICS[0] + DIACRITICS[0]
    expect(row0Stripped).toBe(PLACEHOLDER + DIACRITICS[0] + DIACRITICS[0]);
    // row1: PLACEHOLDER + DIACRITICS[1] + DIACRITICS[0]
    expect(row1Stripped).toBe(PLACEHOLDER + DIACRITICS[1] + DIACRITICS[0]);
  });

  test('column x uses DIACRITICS[x] as its col marker', () => {
    const g = placeholderGrid({ rows: 1, cols: 3, imageId: 0 });
    const stripped = g[0].replace(/\x1b\[[0-9;]*m/g, '');
    // Cells: (PLACEHOLDER+rowD[0]+colD[0]) + (…+colD[1]) + (…+colD[2])
    const cellLen = PLACEHOLDER.length + 2;
    expect(stripped.slice(cellLen * 0 + PLACEHOLDER.length + 1, cellLen * 0 + PLACEHOLDER.length + 2)).toBe(DIACRITICS[0]);
    expect(stripped.slice(cellLen * 1 + PLACEHOLDER.length + 1, cellLen * 1 + PLACEHOLDER.length + 2)).toBe(DIACRITICS[1]);
    expect(stripped.slice(cellLen * 2 + PLACEHOLDER.length + 1, cellLen * 2 + PLACEHOLDER.length + 2)).toBe(DIACRITICS[2]);
  });

  test('image-id is packed into the 24-bit SGR fg colour', () => {
    const id = 0xAA_BB_CC;
    const g = placeholderGrid({ rows: 1, cols: 1, imageId: id });
    // `\x1b[38;2;170;187;204m…\x1b[39m`
    expect(g[0]).toContain('\x1b[38;2;170;187;204m');
    expect(g[0]).toContain('\x1b[39m');
  });

  test('rows=0 or cols=0 → empty grid', () => {
    expect(placeholderGrid({ rows: 0, cols: 5, imageId: 1 })).toEqual([]);
    expect(placeholderGrid({ rows: 5, cols: 0, imageId: 1 })).toEqual([]);
  });
});

describe('delete sequences', () => {
  test('deleteSequence targets specific id', () => {
    const s = deleteSequence(0xDEADBE);
    expect(s).toBe('\x1b_Gq=2,a=d,d=I,i=14593470\x1b\\');
  });

  test('deleteAllSequence clears every image', () => {
    expect(deleteAllSequence()).toBe('\x1b_Gq=2,a=d,d=A\x1b\\');
  });
});

describe('wrapForTmux — DCS passthrough', () => {
  test('wraps in tmux DCS envelope and escapes inner ESCs', () => {
    const inner = '\x1b_Gq=2,a=T;AAAA\x1b\\';
    const wrapped = wrapForTmux(inner);
    expect(wrapped.startsWith('\x1bPtmux;')).toBe(true);
    expect(wrapped.endsWith('\x1b\\')).toBe(true);
    const middle = wrapped.slice('\x1bPtmux;'.length, -'\x1b\\'.length);
    // Every inner ESC must be doubled (the tmux passthrough rule):
    // walk the middle and check that each \x1b is immediately followed
    // by another \x1b. Fails if any "lone" ESC slips through.
    for (let i = 0; i < middle.length; i++) {
      if (middle[i] === '\x1b') {
        expect(middle[i + 1]).toBe('\x1b');
        i++; // skip over the paired second ESC
      }
    }
    // Sanity: the escaped APC prefix is present in its doubled form.
    expect(middle.includes('\x1b\x1b_G')).toBe(true);
  });
});
