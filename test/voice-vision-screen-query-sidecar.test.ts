// Phase B · X7 ↔ Phase A sidecar bridge — vision-screen-query passes
// posture sidecar to visionProvider when resolveSidecar is wired.

import { describe, expect, test } from 'bun:test';
import { runVisionScreenQuery } from '../src/voice/vision-screen-query.js';
import type { ScreenshotPayload } from '../src/voice/vision-screen-query.js';

function fakeDeps(overrides: Record<string, any> = {}) {
  return {
    resolveFocusedSurface: () => ({
      args: { windowId: 'w1', paneId: 'p1' },
      surfaceLabel: 'vw:1/build',
    }),
    dispatchScreenshot: async () => ({
      bodyBase64: 'PNG-bytes',
      bytes: 1024,
    }),
    visionProvider: async (_input: { transcript: string; screenshot: ScreenshotPayload }) =>
      'vision-output',
    speak: async (_s: string) => {},
    ...overrides,
  };
}

describe('runVisionScreenQuery × Phase A sidecar bridge', () => {
  test('without resolveSidecar — payload has no sidecar fields', async () => {
    let capturedPayload: ScreenshotPayload | null = null;
    const deps = fakeDeps({
      visionProvider: async (input: { transcript: string; screenshot: ScreenshotPayload }) => {
        capturedPayload = input.screenshot;
        return 'ok';
      },
    });
    const result = await runVisionScreenQuery({ transcript: 'what is this?' }, deps);
    expect(result.outcome).toBe('spoken');
    expect(capturedPayload!).toBeDefined();
    expect((capturedPayload! as ScreenshotPayload).sidecarText).toBeUndefined();
    expect((capturedPayload! as ScreenshotPayload).sidecarSummary).toBeUndefined();
  });

  test('with resolveSidecar returning text — payload carries sidecar to provider', async () => {
    let capturedPayload: ScreenshotPayload | null = null;
    const deps = fakeDeps({
      resolveSidecar: () => ({
        sidecarText: '[Capture metadata]\nposture: surface=vw:1/build',
        sidecarSummary: 'capture: vw:1/build (observe-only) · intents=2',
      }),
      visionProvider: async (input: { transcript: string; screenshot: ScreenshotPayload }) => {
        capturedPayload = input.screenshot;
        return 'ok';
      },
    });
    const result = await runVisionScreenQuery({ transcript: 'what is this?' }, deps);
    expect(result.outcome).toBe('spoken');
    expect((capturedPayload! as ScreenshotPayload).sidecarText).toContain('[Capture metadata]');
    expect((capturedPayload! as ScreenshotPayload).sidecarSummary).toContain('vw:1/build');
  });

  test('resolveSidecar returning null — payload has no sidecar (graceful)', async () => {
    let capturedPayload: ScreenshotPayload | null = null;
    const deps = fakeDeps({
      resolveSidecar: () => null,
      visionProvider: async (input: { transcript: string; screenshot: ScreenshotPayload }) => {
        capturedPayload = input.screenshot;
        return 'ok';
      },
    });
    await runVisionScreenQuery({ transcript: 'q' }, deps);
    expect((capturedPayload! as ScreenshotPayload).sidecarText).toBeUndefined();
  });

  test('resolveSidecar throwing — vision proceeds with bare payload (graceful failure)', async () => {
    let capturedPayload: ScreenshotPayload | null = null;
    const debugCalls: any[] = [];
    const deps = fakeDeps({
      resolveSidecar: () => { throw new Error('substrate-down'); },
      logDebug: (cat: string, ev: string, data: any) => {
        debugCalls.push({ cat, ev, data });
      },
      visionProvider: async (input: { transcript: string; screenshot: ScreenshotPayload }) => {
        capturedPayload = input.screenshot;
        return 'ok';
      },
    });
    const result = await runVisionScreenQuery({ transcript: 'q' }, deps);
    expect(result.outcome).toBe('spoken'); // not failed
    expect((capturedPayload! as ScreenshotPayload).sidecarText).toBeUndefined();
    // sidecar failure was logged
    expect(debugCalls.some((c) => c.cat === 'voice.vision-query.sidecar-failed')).toBe(true);
  });
});
