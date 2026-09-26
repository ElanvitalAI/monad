// ── X4 (Phase 1 Bundle 2) — pfc-screenshot-attachment tests ──

import { describe, expect, test } from 'bun:test';
import {
  createPfcScreenshotAttacher,
} from '../src/conductor/pfc-screenshot-attachment';
import type { PfcReverseFeedbackNotification } from '../src/conductor/pfc-reverse-feedback';

function notification(): PfcReverseFeedbackNotification {
  return {
    shellId: 's1',
    summary: '🧠 elanous · sh-s1 (exit 1)',
    canApply: true,
    capability: { canRead: true, canInterrupt: true, canWrite: true, canInspect: true },
    research: {
      classification: { clazz: 'error-with-trace', exitCode: 1, errorMarker: 'Error', tail: '' },
      candidates: [{ label: 'Error', source: 'heuristic' }],
      elapsedMs: 5,
    },
  };
}

describe('createPfcScreenshotAttacher', () => {
  test('no resolveScreenshotTarget → notification unchanged', async () => {
    const a = createPfcScreenshotAttacher({});
    const out = await a.attach(notification());
    expect(out).toEqual(notification());
    expect((out as { attachments?: unknown }).attachments).toBeUndefined();
  });

  test('target null → notification unchanged', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => null,
      dispatchScreenshot: async () => ({ bodyBase64: 'AAA', bytes: 100 }),
    });
    const out = await a.attach(notification());
    expect((out as { attachments?: unknown }).attachments).toBeUndefined();
  });

  test('successful capture attaches screenshot', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: (id) => ({ surfaceId: `pane-${id}`, args: { paneId: 'p1' } }),
      dispatchScreenshot: async () => ({ bodyBase64: 'AAA==', bytes: 12, note: '80x24' }),
      now: () => 999,
    });
    const out = await a.attach(notification()) as PfcReverseFeedbackNotification & {
      attachments?: ReadonlyArray<{ kind: string; bodyBase64: string; capturedAt: number; note?: string; surfaceId: string }>;
    };
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments![0]!.kind).toBe('screenshot-png');
    expect(out.attachments![0]!.bodyBase64).toBe('AAA==');
    expect(out.attachments![0]!.surfaceId).toBe('pane-s1');
    expect(out.attachments![0]!.capturedAt).toBe(999);
    expect(out.attachments![0]!.note).toBe('80x24');
  });

  test('dispatcher throws → notification unchanged (graceful)', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => ({ surfaceId: 'x', args: {} }),
      dispatchScreenshot: async () => { throw new Error('boom'); },
    });
    const out = await a.attach(notification());
    expect((out as { attachments?: unknown }).attachments).toBeUndefined();
  });

  test('budget exceeded → notification unchanged', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => ({ surfaceId: 'x', args: {} }),
      dispatchScreenshot: () => new Promise((resolve) => {
        setTimeout(() => resolve({ bodyBase64: 'A' }), 200);
      }),
      budgetMs: 50,
    });
    const out = await a.attach(notification());
    expect((out as { attachments?: unknown }).attachments).toBeUndefined();
  });

  test('result without bodyBase64 → notification unchanged', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => ({ surfaceId: 'x', args: {} }),
      dispatchScreenshot: async () => ({ bytes: 0 }),
    });
    const out = await a.attach(notification());
    expect((out as { attachments?: unknown }).attachments).toBeUndefined();
  });

  test('passes format=png even when target args lack format', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => ({ surfaceId: 'x', args: { paneId: 'p1' } }),
      dispatchScreenshot: async (args) => {
        capturedArgs = args;
        return { bodyBase64: 'AAA' };
      },
    });
    await a.attach(notification());
    expect(capturedArgs).toEqual({ paneId: 'p1', format: 'png' });
  });

  test('notification fields preserved when attachments added', async () => {
    const a = createPfcScreenshotAttacher({
      resolveScreenshotTarget: () => ({ surfaceId: 'x', args: {} }),
      dispatchScreenshot: async () => ({ bodyBase64: 'AAA' }),
    });
    const orig = notification();
    const out = await a.attach(orig);
    expect(out.shellId).toBe(orig.shellId);
    expect(out.summary).toBe(orig.summary);
    expect(out.canApply).toBe(orig.canApply);
  });
});
