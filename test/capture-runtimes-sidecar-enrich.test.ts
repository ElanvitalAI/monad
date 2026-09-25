// Phase A · X2 closure — enrichScreenshotResult helper validates that
// capture-runtimes auto-attaches posture sidecar fields when metaDeps
// is supplied at registration time. Tests the pure helper directly so
// we don't need to mock module-level imports (per CLAUDE.md testing
// strategy: avoid `mock.module()` — use real wiring or `spyOn`).

import { describe, expect, test } from 'bun:test';
import { enrichScreenshotResult } from '../src/tool-runtime/capture-runtimes.js';
import type { ScreenshotMetaSourcesDeps } from '../src/capture/screenshot-with-meta.js';

const fakeBase = { bodyBase64: 'fake-png', bytes: 42, note: '512x256' };

const fakeMetaDeps: ScreenshotMetaSourcesDeps = {
  resolvePosture: () => ({
    surfaceId: 'vw:7/test',
    exposure: { userExposure: 'observe-only' } as any,
    capability: {
      canRead: true,
      canInterrupt: false,
      canWrite: false,
      canInspect: true,
    } as any,
  }),
  recentIntents: () => [
    { kind: 'click', surfaceId: 'vw:7/test', row: 1, col: 2, ts: 1000 },
  ],
  now: () => 2000,
};

describe('enrichScreenshotResult', () => {
  test('without metaDeps — returns base verbatim (back-compat)', () => {
    const result = enrichScreenshotResult(fakeBase, { windowId: 'w1' }, null);
    expect(result).toEqual(fakeBase);
    expect((result as any)._meta).toBeUndefined();
    expect((result as any)._sidecarText).toBeUndefined();
  });

  test('with metaDeps — base preserved + sidecar fields appended', () => {
    const result = enrichScreenshotResult(
      fakeBase,
      { windowId: 'w7', paneId: 'p7' },
      fakeMetaDeps,
    ) as any;

    // base preserved verbatim
    expect(result.bodyBase64).toBe('fake-png');
    expect(result.bytes).toBe(42);
    expect(result.note).toBe('512x256');

    // sidecar fields present
    expect(result._meta).toBeDefined();
    expect(result._meta.posture.surfaceId).toBe('vw:7/test');
    expect(result._meta.recentIntents).toHaveLength(1);
    expect(result._meta.composedAt).toBe(2000);

    // text rendering uses default English locale
    expect(result._sidecarText).toContain('[Capture metadata]');
    expect(result._sidecarText).toContain('vw:7/test');
    expect(result._sidecarText).toContain('exposure=observe-only');
    expect(result._sidecarText).toContain('cap=[read,inspect]');

    // summary is single-line + machine-stable
    expect(result._sidecarSummary).toBe(
      'capture: vw:7/test (observe-only) · intents=1',
    );
    expect(result._sidecarSummary.split('\n')).toHaveLength(1);
  });

  test('with metaDeps + ko locale — text rendered in Korean', () => {
    const koDeps: ScreenshotMetaSourcesDeps = {
      resolvePosture: () => null,
      recentIntents: () => [],
      now: () => 3000,
    };
    const result = enrichScreenshotResult(fakeBase, {}, koDeps, 'ko') as any;
    expect(result._sidecarText).toContain('[캡처 메타데이터]');
    expect(result._sidecarText).toContain('표면 미식별');
    expect(result._sidecarSummary).toBe('캡처: surface 미식별 · intents=0');
  });

  test('null posture + non-empty intents — summary still single-line', () => {
    const deps: ScreenshotMetaSourcesDeps = {
      resolvePosture: () => null,
      recentIntents: () => [
        { kind: 'key', surfaceId: 'x', row: 0, col: 0, ts: 100 },
        { kind: 'key', surfaceId: 'x', row: 0, col: 1, ts: 200 },
      ],
      now: () => 500,
    };
    const result = enrichScreenshotResult(fakeBase, {}, deps) as any;
    expect(result._sidecarSummary).toBe('capture: no-surface · intents=2');
  });
});
