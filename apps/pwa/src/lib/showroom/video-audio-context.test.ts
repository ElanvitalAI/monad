/** R6 Task 4 · §6.3 — pure helper coverage for video / audio context.
 *
 *  The browser-side extraction modules (`video-frame-extract` /
 *  `audio-stt-extract`) are exercised by the manual smoke flow since
 *  they require a real `<video>` decoder + Web Audio backend. This
 *  test pins down the dispatch-side helpers in `runtime.ts`:
 *  ID generation, default labels, prompt prefix shape, and escape
 *  sanitization. */

import { describe, expect, test } from 'bun:test';
import {
  defaultAudioContextLabel,
  defaultVideoContextLabel,
  formatAudioContextPrefix,
  formatDurationMmSs,
  formatVideoContextPrefix,
  newAudioContextId,
  newVideoContextId,
} from './runtime';
import { pickSeekOffset } from '../video-frame-extract';
import type {
  ShowroomAudioContext,
  ShowroomVideoContext,
} from './types';

const NOW = 1_700_000_000_000;

function buildVideo(overrides: Partial<ShowroomVideoContext> = {}): ShowroomVideoContext {
  return {
    id: 'vc-1',
    label: 'video · 0:30 · 1280x720 · 2024-01-01',
    filename: 'sample.mp4',
    mimeType: 'video/mp4',
    durationSec: 30,
    widthPx: 1280,
    heightPx: 720,
    frameDataUrl: 'data:image/png;base64,AAAA',
    capturedAt: NOW,
    ...overrides,
  };
}

function buildAudio(overrides: Partial<ShowroomAudioContext> = {}): ShowroomAudioContext {
  return {
    id: 'ac-1',
    label: 'audio · 0:30 · 2024-01-01',
    filename: 'speech.m4a',
    mimeType: 'audio/m4a',
    durationSec: 30,
    sizeBytes: 102400,
    transcript: '',
    loadedAt: NOW,
    ...overrides,
  };
}

describe('runtime · IDs', () => {
  test('newVideoContextId is unique on consecutive calls', () => {
    const a = newVideoContextId();
    const b = newVideoContextId();
    expect(a).toMatch(/^vc-/);
    expect(b).toMatch(/^vc-/);
    expect(a).not.toBe(b);
  });

  test('newAudioContextId is unique on consecutive calls', () => {
    const a = newAudioContextId();
    const b = newAudioContextId();
    expect(a).toMatch(/^ac-/);
    expect(b).toMatch(/^ac-/);
    expect(a).not.toBe(b);
  });
});

describe('runtime · formatDurationMmSs', () => {
  test('zero, sub-minute, multi-minute formatting', () => {
    expect(formatDurationMmSs(0)).toBe('0:00');
    expect(formatDurationMmSs(7)).toBe('0:07');
    expect(formatDurationMmSs(59)).toBe('0:59');
    expect(formatDurationMmSs(60)).toBe('1:00');
    expect(formatDurationMmSs(125)).toBe('2:05');
  });

  test('negative + non-finite clamp to 0:00', () => {
    expect(formatDurationMmSs(-5)).toBe('0:00');
    expect(formatDurationMmSs(NaN)).toBe('0:00');
    expect(formatDurationMmSs(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('runtime · default labels', () => {
  test('defaultVideoContextLabel includes duration + dims + date', () => {
    const label = defaultVideoContextLabel(125, 1920, 1080, NOW);
    expect(label).toMatch(/^video · 2:05 · 1920x1080 · \d{4}-\d{2}-\d{2}$/);
  });

  test('defaultAudioContextLabel includes duration + date', () => {
    const label = defaultAudioContextLabel(45, NOW);
    expect(label).toMatch(/^audio · 0:45 · \d{4}-\d{2}-\d{2}$/);
  });
});

describe('runtime · formatVideoContextPrefix', () => {
  test('empty list → empty string', () => {
    expect(formatVideoContextPrefix([])).toBe('');
  });

  test('single video → block + trailing double-newline', () => {
    const out = formatVideoContextPrefix([buildVideo()]);
    expect(out).toContain('<video_context');
    expect(out).toContain('label="video · 0:30 · 1280x720 · 2024-01-01"');
    expect(out).toContain('filename="sample.mp4"');
    expect(out).toContain('duration="0:30"');
    expect(out).toContain('dimensions="1280x720"');
    expect(out).toContain('<frame data="data:image/png;base64,AAAA" />');
    expect(out.endsWith('\n\n')).toBe(true);
  });

  test('multiple videos preserve order with double-newline separator', () => {
    const out = formatVideoContextPrefix([
      buildVideo({ id: 'vc-a', filename: 'a.mp4' }),
      buildVideo({ id: 'vc-b', filename: 'b.mp4' }),
    ]);
    const aIdx = out.indexOf('a.mp4');
    const bIdx = out.indexOf('b.mp4');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  test('label/filename/mime escape <>" so the block stays valid', () => {
    const out = formatVideoContextPrefix([buildVideo({
      label: 'evil "<inject>"',
      filename: 'a"b.mp4',
      mimeType: 'video/<x>',
    })]);
    expect(out).not.toContain('"<inject>"');
    expect(out).toContain('label="evil _'); // sanitized
    expect(out).toContain('filename="a_b.mp4"');
    expect(out).toContain('mime="video/_x_"');
  });
});

describe('runtime · formatAudioContextPrefix', () => {
  test('empty list → empty string', () => {
    expect(formatAudioContextPrefix([])).toBe('');
  });

  test('audio without transcript → block omits <transcript>', () => {
    const out = formatAudioContextPrefix([buildAudio()]);
    expect(out).toContain('<audio_context');
    expect(out).toContain('size="102400 bytes"');
    expect(out).not.toContain('<transcript>');
  });

  test('audio with transcript → block embeds it', () => {
    const out = formatAudioContextPrefix([buildAudio({ transcript: 'hello world' })]);
    expect(out).toContain('<transcript>hello world</transcript>');
  });

  test('multiple audios preserve order', () => {
    const out = formatAudioContextPrefix([
      buildAudio({ id: 'ac-a', filename: 'a.mp3' }),
      buildAudio({ id: 'ac-b', filename: 'b.mp3' }),
    ]);
    expect(out.indexOf('b.mp3')).toBeGreaterThan(out.indexOf('a.mp3'));
  });
});

describe('video-frame-extract · pickSeekOffset', () => {
  test('< 2s clip → 10% in (with 0.05 floor)', () => {
    expect(pickSeekOffset(1.0)).toBeCloseTo(0.1, 4);
    expect(pickSeekOffset(0.3)).toBeCloseTo(0.05, 4); // floor case
    expect(pickSeekOffset(1.5)).toBeCloseTo(0.15, 4);
  });

  test('≥ 2s clip → 1.0s', () => {
    expect(pickSeekOffset(2.0)).toBe(1);
    expect(pickSeekOffset(120)).toBe(1);
  });

  test('zero / negative / NaN → 0', () => {
    expect(pickSeekOffset(0)).toBe(0);
    expect(pickSeekOffset(-1)).toBe(0);
    expect(pickSeekOffset(NaN)).toBe(0);
  });
});
