// ── X2 (Phase 2 Bundle 1) — screenshot-with-meta tests ──

import { describe, expect, test } from 'bun:test';
import {
  composeScreenshotMeta,
  dispatchScreenshotWithMeta,
} from '../../src/capture/screenshot-with-meta';

describe('composeScreenshotMeta', () => {
  test('preserves base + adds null posture when no resolver', () => {
    const out = composeScreenshotMeta(
      { format: 'png', bytes: 12 },
      { paneId: 'p1' },
      {},
    );
    expect(out.base).toEqual({ format: 'png', bytes: 12 });
    expect(out.posture).toBeNull();
    expect(out.recentIntents).toEqual([]);
    expect(typeof out.composedAt).toBe('number');
  });

  test('passes target to resolvePosture', () => {
    let captured: unknown = null;
    composeScreenshotMeta(
      { ok: true },
      { surfaceId: 'vw:3/runner', windowId: '3' },
      {
        resolvePosture: (target) => {
          captured = target;
          return null;
        },
      },
    );
    expect(captured).toEqual({ surfaceId: 'vw:3/runner', windowId: '3' });
  });

  test('attaches posture when resolver returns one', () => {
    const out = composeScreenshotMeta(
      { ok: true },
      { surfaceId: 's1' },
      {
        resolvePosture: () => ({
          surfaceId: 's1',
          exposure: { userExposure: 'user-interactive', agentInteractive: true },
          capability: { canRead: true, canInterrupt: true, canWrite: true, canInspect: true },
        }),
      },
    );
    expect(out.posture).not.toBeNull();
    expect(out.posture!.exposure.userExposure).toBe('user-interactive');
  });

  test('attaches recent intents from accessor', () => {
    const intents = [
      { kind: 'word-select', surfaceId: 's1', row: 1, col: 2 },
      { kind: 'caret-focus', surfaceId: 's1', row: 3, col: 4 },
    ];
    const out = composeScreenshotMeta(
      { ok: true },
      { surfaceId: 's1' },
      { recentIntents: () => intents },
    );
    expect(out.recentIntents).toEqual(intents);
  });

  test('honors `now` test seam', () => {
    const out = composeScreenshotMeta(
      { ok: true },
      { surfaceId: 's1' },
      { now: () => 999 },
    );
    expect(out.composedAt).toBe(999);
  });
});

describe('dispatchScreenshotWithMeta', () => {
  test('chains dispatch + compose', async () => {
    const out = await dispatchScreenshotWithMeta(
      { paneId: 'p1', format: 'png' },
      async (args) => ({ format: args.format, bytes: 100 }),
      {
        resolvePosture: () => ({
          surfaceId: 'p1',
          exposure: { userExposure: 'observe-only', agentInteractive: true },
          capability: { canRead: true, canInterrupt: true, canWrite: false, canInspect: true },
        }),
        recentIntents: () => [{ kind: 'caret-focus', surfaceId: 'p1', row: 0, col: 0 }],
      },
    );
    expect(out.base).toEqual({ format: 'png', bytes: 100 });
    expect(out.posture!.exposure.userExposure).toBe('observe-only');
    expect(out.recentIntents).toHaveLength(1);
  });

  test('propagates dispatch throws', async () => {
    await expect(dispatchScreenshotWithMeta(
      {},
      async () => { throw new Error('capture failed'); },
      {},
    )).rejects.toThrow('capture failed');
  });
});
