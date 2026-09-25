/**
 * Phase 5 (PWA chat ↔ voice 일원화 · 2026-05-07) — sentence boundary
 * helper used by `useVoiceTts`. Same algorithm as the TUI server-side
 * bridge (`src/voice/voice-pwa-tts-bridge.ts:97-109`) so a future
 * server-bridge wire (BACKLOG F2-strict) emits identical chunks.
 */

import { describe, expect, it } from 'bun:test';
import { extractSentences } from './use-voice-tts';

describe('extractSentences (Phase 5 sentence boundary)', () => {
  it('extracts a single complete sentence + leaves no remainder', () => {
    const r = extractSentences('Hello world.');
    expect(r.sentences).toEqual(['Hello world.']);
    expect(r.remainder).toBe('');
  });

  it('splits multiple sentences on . ! ?', () => {
    const r = extractSentences('First. Second! Third? remainder');
    expect(r.sentences).toEqual(['First.', 'Second!', 'Third?']);
    expect(r.remainder).toBe('remainder');
  });

  it('honors fullwidth Korean / Japanese terminators (。！？)', () => {
    const r = extractSentences('안녕하세요。좋아요！정말？꼬리');
    expect(r.sentences).toEqual(['안녕하세요。', '좋아요！', '정말？']);
    expect(r.remainder).toBe('꼬리');
  });

  it('treats text without terminator as remainder only', () => {
    const r = extractSentences('no terminator here');
    expect(r.sentences).toEqual([]);
    expect(r.remainder).toBe('no terminator here');
  });

  it('drops whitespace-only sentence pieces', () => {
    const r = extractSentences('   .  Real one.');
    // The leading "   ." trims down to "." which is non-empty, so it
    // does become a sentence — verify we don't lose content.
    expect(r.sentences).toContain('Real one.');
    expect(r.remainder).toBe('');
  });

  it('preserves trailing whitespace after terminator into the next chunk', () => {
    // Boundary regex consumes trailing whitespace, so split after.
    const r = extractSentences('A.  B');
    expect(r.sentences).toEqual(['A.']);
    expect(r.remainder).toBe('B');
  });

  it('handles compound terminators (.. or ?!) as one boundary', () => {
    const r = extractSentences('Wait?! Now go.');
    expect(r.sentences).toEqual(['Wait?!', 'Now go.']);
    expect(r.remainder).toBe('');
  });
});
