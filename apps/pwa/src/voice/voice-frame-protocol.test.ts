// Frame protocol — round-trip encode/decode + enum values lock.
// New cases: BI-1 manual barge-in (UPSTREAM_INTERRUPT 0x04 · Phase D).

import { describe, expect, test } from 'bun:test';
import {
  PWA_VOICE_FRAME_KIND,
  encodeFrame,
  decodeFrame,
} from './voice-frame-protocol';

describe('PWA_VOICE_FRAME_KIND constants', () => {
  test('upstream kinds are the canonical low-byte values', () => {
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_PCM).toBe(0x01);
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_FINALIZE).toBe(0x02);
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_HELLO).toBe(0x03);
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_INTERRUPT).toBe(0x04);
  });

  test('downstream kinds are the high-byte (0x8x) values', () => {
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_PCM).toBe(0x81);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_STATE).toBe(0x82);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_ERROR).toBe(0x83);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_TRANSCRIPT).toBe(0x84);
  });
});

describe('encodeFrame + decodeFrame round-trip', () => {
  test('UPSTREAM_INTERRUPT empty payload round-trips', () => {
    const buf = encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_INTERRUPT, new Uint8Array(0));
    const decoded = decodeFrame(buf);
    expect(decoded.kind).toBe(PWA_VOICE_FRAME_KIND.UPSTREAM_INTERRUPT);
    expect(decoded.payload.byteLength).toBe(0);
    expect(decoded.flags).toBe(0);
  });

  test('UPSTREAM_FINALIZE round-trip stays unaffected', () => {
    const buf = encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_FINALIZE, new Uint8Array(0));
    const decoded = decodeFrame(buf);
    expect(decoded.kind).toBe(PWA_VOICE_FRAME_KIND.UPSTREAM_FINALIZE);
    expect(decoded.payload.byteLength).toBe(0);
  });

  test('UPSTREAM_PCM with payload preserves bytes', () => {
    const payload = new Uint8Array([0x10, 0x20, 0x30]);
    const buf = encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_PCM, payload);
    const decoded = decodeFrame(buf);
    expect(decoded.kind).toBe(PWA_VOICE_FRAME_KIND.UPSTREAM_PCM);
    expect(Array.from(decoded.payload)).toEqual([0x10, 0x20, 0x30]);
  });

  test('decodeFrame throws on truncated buffer', () => {
    expect(() => decodeFrame(new ArrayBuffer(2))).toThrow();
  });
});
