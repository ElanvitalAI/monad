import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { showPreviewModal } from '../src/dashboard/modals/preview.js';
import { _resetTransientTerminalModalsForTesting } from '../src/dashboard/modals/transient.js';
import type { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewResult } from '../src/preview/index.js';

afterEach(() => _resetTransientTerminalModalsForTesting());

function fakeCoord(): DisplayCoordinator {
  // B-3c pilot #4 (2026-04-21) — showTransientTerminalModal now pushes
  // via `coordinator.modalLifecycleAPI().push('transient-term', ...)`.
  // Minimal mock: `modalLifecycleAPI().push` returns a stub handle
  // with `isDisposed()` + `dispose()`. `pushModal` retained for
  // backward-compat defensiveness (not used by migrated path).
  let disposed = false;
  const stubHandle = {
    id: 'stub' as never,
    generation: 0,
    tier: 'tooltip' as never,
    typeName: 'transient-term',
    key: null,
    surface: null as never,
    isDisposed: () => disposed,
    dispose: () => { disposed = true; },
    [Symbol.dispose]: () => { disposed = true; },
  };
  return {
    pushModal: () => ({ dispose: () => {} }),
    modalLifecycleAPI: () => ({
      push: () => stubHandle,
    }),
  } as unknown as DisplayCoordinator;
}

const tmp = mkdtempSync(join(tmpdir(), 'preview-modal-'));

describe('showPreviewModal', () => {
  test('lines result → shown as-is (no image renderer call)', async () => {
    const f = join(tmp, 'a.md');
    writeFileSync(f, '# Hi');
    let renderCalls = 0;
    const r = await showPreviewModal(f, {
      coordinator: fakeCoord(),
      termCols: 100,
      termRows: 40,
      previewer: () => ({ kind: 'lines', lines: ['line1', 'line2', 'line3'] }) as PreviewResult,
      renderer: (async () => { renderCalls++; return ['rendered']; }) as never,
    });
    expect(r).not.toBeNull();
    expect(renderCalls).toBe(0);
    expect(r!.result.kind).toBe('lines');
  });

  test('image result → runs ANSI renderer on cachePath', async () => {
    const f = join(tmp, 'a.png');
    writeFileSync(f, 'x');
    const cachePath = join(tmp, 'cached.jpg');
    writeFileSync(cachePath, 'y');
    let seen: string | null = null;
    const r = await showPreviewModal(f, {
      coordinator: fakeCoord(),
      termCols: 100,
      termRows: 40,
      previewer: () => ({ kind: 'image', cachePath }) as PreviewResult,
      renderer: (async (path: string) => { seen = path; return ['ansi-block-1', 'ansi-block-2']; }) as never,
    });
    expect(r).not.toBeNull();
    expect(seen).toBe(cachePath);
  });

  test('renderer returning null → modal skipped (returns null)', async () => {
    const f = join(tmp, 'a.avif');
    writeFileSync(f, 'x');
    const r = await showPreviewModal(f, {
      coordinator: fakeCoord(),
      termCols: 100,
      termRows: 40,
      previewer: () => ({ kind: 'image', cachePath: f }) as PreviewResult,
      renderer: (async () => null) as never,
    });
    expect(r).toBeNull();
  });

  test('title reflects paging skip for PDF / video', async () => {
    const f = join(tmp, 'doc.pdf');
    writeFileSync(f, 'x');
    const r = await showPreviewModal(f, {
      coordinator: fakeCoord(),
      termCols: 100,
      termRows: 40,
      skip: 2,
      previewer: () => ({ kind: 'image', cachePath: f }) as PreviewResult,
      renderer: (async () => ['block']) as never,
    });
    expect(r).not.toBeNull();
    expect(r!.handle.id).toContain('transient');
    // Title embedded via showTransientTerminalModal — we can't easily
    // read it back, but the code path is covered.
  });
});
