// Unit tests for the folder attach picker modal — Arc C Phase 1.
//
// Covers the pure build helper and the async factory's shell-out
// behavior using the spawnImpl injection seam finder-scan already
// exposes. The modal factory is integration-tested via the downstream
// picker-state / dashboard paths (Phases 2-3); these tests focus on
// the transform contract.

import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import {
  buildFolderPickerItems,
  createFolderPickerModal,
  type FinderItem,
} from '../src/finder/finder-modal.js';
import type { ModalBounds } from '../src/display/modal-stack.js';

describe('buildFolderPickerItems', () => {
  test('relativizes paths against the folder root', () => {
    const root = '/Users/foo/Documents';
    const items = buildFolderPickerItems(
      [
        '/Users/foo/Documents/invoices/2026-01.pdf',
        '/Users/foo/Documents/notes.md',
      ],
      root,
    );
    expect(items).toEqual([
      { relPath: 'invoices/2026-01.pdf', absPath: '/Users/foo/Documents/invoices/2026-01.pdf' },
      { relPath: 'notes.md',             absPath: '/Users/foo/Documents/notes.md' },
    ]);
  });

  test('keeps absolute paths that fall outside the root', () => {
    const root = '/a/b';
    const items = buildFolderPickerItems(['/a/b/c.txt', '/zzz/other.txt'], root);
    expect(items[0]).toEqual({ relPath: 'c.txt',            absPath: '/a/b/c.txt' });
    expect(items[1]).toEqual({ relPath: '/zzz/other.txt',   absPath: '/zzz/other.txt' });
  });

  test('empty scan → empty items array', () => {
    expect(buildFolderPickerItems([], '/anywhere')).toEqual([]);
  });

  test('single-file folder preserves basename', () => {
    const items = buildFolderPickerItems(['/tmp/onlyfile.txt'], '/tmp');
    expect(items).toEqual([{ relPath: 'onlyfile.txt', absPath: '/tmp/onlyfile.txt' }]);
  });
});

// Minimal child-process fake matching the shape scanFinder expects:
// emits `data` on `stdout` with newline-separated paths, then emits
// `close`. Used to drive the async factory deterministically.
function fakeSpawner(linesByArgv: (argv: readonly string[]) => string[]) {
  return (cmd: string, args: readonly string[]) => {
    const child = new EventEmitter() as unknown as {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig: string) => void;
      on: (ev: string, fn: (...a: unknown[]) => void) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      const lines = linesByArgv([cmd, ...args]);
      child.stdout.emit('data', Buffer.from(lines.map(l => l + '\n').join('')));
      (child as unknown as EventEmitter).emit('close', 0);
    });
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
  };
}

const BOUNDS: ModalBounds = { row: 3, col: 1, width: 80, height: 12 };

describe('createFolderPickerModal', () => {
  test('mounts a finder modal over the scanned file list', async () => {
    const paths = [
      '/Users/foo/Documents/a.txt',
      '/Users/foo/Documents/subdir/b.md',
    ];
    const handle = await createFolderPickerModal(
      {
        folderPath: '/Users/foo/Documents',
        bounds: BOUNDS,
        width: 80,
        onAccept: () => {},
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => paths),
      },
    );
    // The returned handle is the same shape createSearchModal exposes —
    // surface + imperative accept/cancel/nav controls. Inspect the
    // state to confirm the scanned items were threaded through.
    expect(handle).toBeDefined();
    expect(handle.surface).toBeDefined();
    const state = handle.state();
    expect(state.items).toHaveLength(2);
    expect(state.selectedIdx).toBe(0);
  });

  test('onAccept fires with the FinderItem matching the highlighted row', async () => {
    const picked: FinderItem[] = [];
    const handle = await createFolderPickerModal(
      {
        folderPath: '/x',
        bounds: BOUNDS,
        width: 80,
        onAccept: (item) => picked.push(item),
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => ['/x/one.txt', '/x/two.md']),
      },
    );
    // Move cursor to row 1 (`two.md`), then accept.
    handle.down();
    handle.accept();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toEqual({ relPath: 'two.md', absPath: '/x/two.md' });
  });

  test('first row accepted by default when no navigation happens', async () => {
    const picked: FinderItem[] = [];
    const handle = await createFolderPickerModal(
      {
        folderPath: '/x',
        bounds: BOUNDS,
        width: 80,
        onAccept: (item) => picked.push(item),
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => ['/x/one.txt', '/x/two.md']),
      },
    );
    handle.accept();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toEqual({ relPath: 'one.txt', absPath: '/x/one.txt' });
  });

  test('onCancel fires when Esc closes the modal', async () => {
    let cancelled = 0;
    const handle = await createFolderPickerModal(
      {
        folderPath: '/empty-folder',
        bounds: BOUNDS,
        width: 80,
        onAccept: () => {},
        onCancel: () => { cancelled++; },
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => []),
      },
    );
    handle.cancel();
    expect(cancelled).toBe(1);
  });

  test('empty folder produces a handle with zero items and (no matches) state', async () => {
    const handle = await createFolderPickerModal(
      {
        folderPath: '/empty-folder',
        bounds: BOUNDS,
        width: 80,
        onAccept: () => {},
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => []),
      },
    );
    expect(handle.state().items).toHaveLength(0);
  });

  test('typing narrows the visible items (createFinderModal rank semantics)', async () => {
    const handle = await createFolderPickerModal(
      {
        folderPath: '/x',
        bounds: BOUNDS,
        width: 80,
        onAccept: () => {},
      },
      {
        probeBackend: () => 'fd',
        spawnImpl: fakeSpawner(() => [
          '/x/invoice.pdf',
          '/x/notes.md',
          '/x/subdir/invoice-2.pdf',
        ]),
      },
    );
    // Initial: 3 items, no query
    expect(handle.state().items).toHaveLength(3);
    // Type "inv" — should narrow to the two invoices
    for (const ch of 'inv') handle.type(ch);
    expect(handle.state().items.length).toBeLessThan(3);
    const labels = handle.state().items.map(i => String(i.payload));
    for (const absPath of labels) expect(absPath.toLowerCase()).toContain('inv');
  });
});
