import { describe, expect, test } from 'bun:test';
import {
  sidecarToSummaryLine,
  sidecarToSystemNote,
} from '../src/capture/posture-sidecar.js';
import type { ScreenshotWithMeta } from '../src/capture/screenshot-with-meta.js';

const fixedTime = 1714746191000; // 2024-05-03T14:23:11Z (deterministic)

function fakeMeta(overrides: Partial<ScreenshotWithMeta<{ note: string }>> = {}): ScreenshotWithMeta<{ note: string }> {
  return {
    base: { note: 'png-bytes' },
    posture: {
      surfaceId: 'vw:42/build',
      exposure: { userExposure: 'observe-only' } as any,
      capability: { canRead: true, canInterrupt: true, canWrite: false, canInspect: true } as any,
    },
    recentIntents: [
      { kind: 'click', surfaceId: 'vw:42/build', row: 3, col: 12, ts: fixedTime - 2000 },
      { kind: 'key', surfaceId: 'vw:42/build', row: 4, col: 0, ts: fixedTime - 500 },
    ],
    composedAt: fixedTime,
    ...overrides,
  };
}

describe('sidecarToSystemNote', () => {
  test('renders English by default with header, posture, and intents', () => {
    const text = sidecarToSystemNote(fakeMeta());
    expect(text).toContain('[Capture metadata]');
    expect(text).toContain('composed at:');
    expect(text).toContain('surface=vw:42/build');
    expect(text).toContain('exposure=observe-only');
    expect(text).toContain('cap=[read,inspect,interrupt]');
    expect(text).toContain('recent intents (2/2):');
    expect(text).toContain('click@vw:42/build');
    expect(text).toContain('key@vw:42/build');
  });

  test('renders Korean when locale=ko', () => {
    const text = sidecarToSystemNote(fakeMeta(), { locale: 'ko' });
    expect(text).toContain('[캡처 메타데이터]');
    expect(text).toContain('캡처 시각:');
    expect(text).toContain('최근 intents (2/2):');
  });

  test('says "no surface" when posture is null', () => {
    const text = sidecarToSystemNote(fakeMeta({ posture: null }));
    expect(text).toContain('no surface');
  });

  test('says "표면 미식별" when posture is null and locale=ko', () => {
    const text = sidecarToSystemNote(fakeMeta({ posture: null }), { locale: 'ko' });
    expect(text).toContain('표면 미식별');
  });

  test('caps recent intents to maxIntents and shows ratio', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      kind: 'tick',
      surfaceId: 'vw:1/x',
      row: 0,
      col: i,
      ts: fixedTime - i * 10,
    }));
    const text = sidecarToSystemNote(fakeMeta({ recentIntents: many }), { maxIntents: 5 });
    expect(text).toContain('recent intents (5/25):');
    // Newest 5 are last in the array (slice(-5))
    expect(text).toContain('c20'); // intent at idx 20 — within last 5
    expect(text).not.toContain('c10'); // older — should be sliced out
  });

  test('shows " — none" when no recent intents', () => {
    const text = sidecarToSystemNote(fakeMeta({ recentIntents: [] }));
    expect(text).toContain('recent intents (0/0) — none');
  });

  test('uses formatTime override (test seam)', () => {
    const text = sidecarToSystemNote(fakeMeta(), {
      formatTime: (ms) => `T${ms}`,
    });
    expect(text).toContain(`T${fixedTime}`);
  });
});

describe('sidecarToSummaryLine', () => {
  test('returns short single-line English by default', () => {
    const line = sidecarToSummaryLine(fakeMeta());
    expect(line).toBe('capture: vw:42/build (observe-only) · intents=2');
    expect(line.split('\n')).toHaveLength(1);
  });

  test('returns short single-line Korean when locale=ko', () => {
    const line = sidecarToSummaryLine(fakeMeta(), { locale: 'ko' });
    expect(line).toBe('캡처: vw:42/build (observe-only) · intents=2');
  });

  test('handles null posture', () => {
    const line = sidecarToSummaryLine(fakeMeta({ posture: null }));
    expect(line).toBe('capture: no-surface · intents=2');
  });

  test('handles null posture in Korean', () => {
    const line = sidecarToSummaryLine(fakeMeta({ posture: null }), { locale: 'ko' });
    expect(line).toBe('캡처: surface 미식별 · intents=2');
  });
});
