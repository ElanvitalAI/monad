import { describe, test, expect } from 'bun:test';

import {
  promoteSurface,
  autoBgTargetFor,
  isLegalPromote,
} from '../../src/shell-runner/surface-promote.js';
import type {
  BufferMark,
  ShellHandle,
  ShellResult,
  ShellStatus,
  ShellSurface,
} from '../../src/shell-runner/types.js';

function fakeHandle(status: ShellStatus = 'running'): ShellHandle {
  const bookmark: BufferMark = { row: 0, col: 0, ts: 0, bytes: 0 };
  const result = new Promise<ShellResult>(() => { /* never */ });
  return {
    id: 'h1',
    mode: 'inline',
    get status() { return status; },
    bookmark,
    kill() { /* noop */ },
    background() { return false; },
    promote() { return false; },
    write() { /* noop */ },
    resize() { /* noop */ },
    onChunk() { return () => {}; },
    onBoundary() { return () => {}; },
    onStatus() { return () => {}; },
    result,
  };
}

function fakeSurface(kind: ShellSurface['kind']): ShellSurface & {
  attached: string[];
  detached: number;
} {
  const attached: string[] = [];
  let detachedCount = 0;
  return {
    kind,
    attach(h) { attached.push(h.id); },
    detach() { detachedCount++; },
    get attached() { return attached; },
    get detached() { return detachedCount; },
  };
}

describe('promoteSurface', () => {
  test('detaches from source and attaches to destination', () => {
    const src = fakeSurface('inline');
    const dst = fakeSurface('vw');
    const h = fakeHandle();
    expect(promoteSurface(h, src, dst)).toBe(true);
    expect(src.detached).toBe(1);
    expect(dst.attached).toEqual(['h1']);
  });

  test('null source is allowed (first attach)', () => {
    const dst = fakeSurface('vw');
    const h = fakeHandle();
    expect(promoteSurface(h, null, dst)).toBe(true);
    expect(dst.attached).toEqual(['h1']);
  });

  test('same source and destination: still attaches (idempotent promote)', () => {
    const same = fakeSurface('inline');
    const h = fakeHandle();
    // We do NOT detach when source === destination, to avoid a
    // redundant subscribe/unsubscribe dance.
    expect(promoteSurface(h, same, same)).toBe(true);
    expect(same.detached).toBe(0);
    expect(same.attached).toEqual(['h1']);
  });

  test('settled handle (completed) refuses to promote without force', () => {
    const src = fakeSurface('inline');
    const dst = fakeSurface('vw');
    const h = fakeHandle('completed');
    expect(promoteSurface(h, src, dst)).toBe(false);
    expect(dst.attached).toEqual([]);
  });

  test('settled handle with force:true promotes anyway (re-view)', () => {
    const src = fakeSurface('inline');
    const dst = fakeSurface('vw');
    const h = fakeHandle('killed');
    expect(promoteSurface(h, src, dst, { force: true })).toBe(true);
    expect(dst.attached).toEqual(['h1']);
  });

  test('onPromoted fires with the destination kind', () => {
    const src = fakeSurface('inline');
    const dst = fakeSurface('bg');
    const seen: string[] = [];
    promoteSurface(fakeHandle(), src, dst, { onPromoted: (k) => seen.push(k) });
    expect(seen).toEqual(['bg']);
  });
});

describe('autoBgTargetFor', () => {
  test('inline → bg', () => { expect(autoBgTargetFor('inline')).toBe('bg'); });
  test('modal → bg', () => { expect(autoBgTargetFor('modal')).toBe('bg'); });
  test('bg → null (already bg)', () => { expect(autoBgTargetFor('bg')).toBeNull(); });
  test('vw → null (user already has a pane)', () => { expect(autoBgTargetFor('vw')).toBeNull(); });
});

describe('isLegalPromote', () => {
  test('identity is always legal', () => {
    for (const k of ['inline', 'bg', 'modal', 'vw'] as const) {
      expect(isLegalPromote(k, k)).toBe(true);
    }
  });

  test('matrix table matches session-nt §5 transitions', () => {
    // inline → bg/vw/modal
    expect(isLegalPromote('inline', 'bg')).toBe(true);
    expect(isLegalPromote('inline', 'vw')).toBe(true);
    expect(isLegalPromote('inline', 'modal')).toBe(true);
    // bg → vw/modal/inline
    expect(isLegalPromote('bg', 'vw')).toBe(true);
    expect(isLegalPromote('bg', 'modal')).toBe(true);
    expect(isLegalPromote('bg', 'inline')).toBe(true);
    // modal → vw/bg (not inline — modals are already user-visible)
    expect(isLegalPromote('modal', 'vw')).toBe(true);
    expect(isLegalPromote('modal', 'bg')).toBe(true);
    expect(isLegalPromote('modal', 'inline')).toBe(false);
    // vw → modal/bg (not inline)
    expect(isLegalPromote('vw', 'modal')).toBe(true);
    expect(isLegalPromote('vw', 'bg')).toBe(true);
    expect(isLegalPromote('vw', 'inline')).toBe(false);
  });
});
