// ── Binary detection tests (Phase 4) ──

import { describe, test, expect } from 'bun:test';
import { detectBinary } from '../src/panes/binary-detect';

describe('detectBinary', () => {
  test('empty input → not binary', () => {
    const r = detectBinary('');
    expect(r.binary).toBe(false);
    expect(r.reason).toBe('empty');
  });

  test('plain ASCII text → not binary', () => {
    const r = detectBinary('hello world\nsecond line\n');
    expect(r.binary).toBe(false);
    expect(r.reason).toBe('appears-text');
    expect(r.printableRatio).toBe(1);
  });

  test('NUL byte → binary (hard signal)', () => {
    const r = detectBinary(new Uint8Array([0x48, 0x00, 0x65, 0x6c, 0x6c, 0x6f]));
    expect(r.binary).toBe(true);
    expect(r.reason).toBe('nul-byte');
  });

  test('ELF magic bytes → binary', () => {
    // 0x7f + "ELF" + assorted binary
    const r = detectBinary(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
    // Either nul-byte hit (0x00 in the header) or low printable ratio.
    expect(r.binary).toBe(true);
  });

  test('PNG magic bytes → binary', () => {
    const r = detectBinary(new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]));
    expect(r.binary).toBe(true);
  });

  test('UTF-8 CJK text → not binary', () => {
    const r = detectBinary('한글 テスト 中文\n');
    expect(r.binary).toBe(false);
    expect(r.reason).toBe('appears-text');
  });

  test('heavy control bytes → binary via low ratio', () => {
    // 50 control bytes (not NUL) + a few printable → low ratio
    const bytes = new Uint8Array(60);
    for (let i = 0; i < 50; i++) bytes[i] = 0x01;
    for (let i = 50; i < 60; i++) bytes[i] = 0x41;  // 'A'
    const r = detectBinary(bytes);
    expect(r.binary).toBe(true);
    expect(r.reason).toBe('low-printable-ratio');
  });
});
