import { describe, test, expect } from 'bun:test';

import { createVwSurface } from '../../src/shell-runner/vw-surface.js';
import { INTERRUPT_CHORDS } from '../../src/shell-runner/types.js';
import type {
  BoundaryEvent,
  BufferMark,
  OutputChunk,
  ShellHandle,
  ShellResult,
  ShellStatus,
  Unsubscribe,
} from '../../src/shell-runner/types.js';

function fakeHandle(): ShellHandle & {
  emitChunk: (c: OutputChunk) => void;
  emitStatus: (s: ShellStatus) => void;
  emitBoundary: (ev: BoundaryEvent) => void;
  writes: string[];
} {
  const chunkSubs = new Set<(c: OutputChunk) => void>();
  const statusSubs = new Set<(s: ShellStatus) => void>();
  const boundarySubs = new Set<(ev: BoundaryEvent) => void>();
  let status: ShellStatus = 'running';
  const bookmark: BufferMark = { row: 3, col: 2, ts: 100, bytes: 50 };
  const writes: string[] = [];
  const result = new Promise<ShellResult>(() => { /* never */ });
  return {
    id: 'h-vw',
    mode: 'vw',
    get status() { return status; },
    bookmark,
    kill() { /* noop */ },
    background() { return false; },
    promote() { return false; },
    write(bytes) { writes.push(bytes); },
    resize() { /* noop */ },
    onChunk(cb) { chunkSubs.add(cb); return (() => chunkSubs.delete(cb)) as Unsubscribe; },
    onStatus(cb) { statusSubs.add(cb); return (() => statusSubs.delete(cb)) as Unsubscribe; },
    onBoundary(cb) { boundarySubs.add(cb); return (() => boundarySubs.delete(cb)) as Unsubscribe; },
    result,
    emitChunk(c) { for (const cb of chunkSubs) cb(c); },
    emitStatus(s) { status = s; for (const cb of statusSubs) cb(s); },
    emitBoundary(ev) { for (const cb of boundarySubs) cb(ev); },
    writes,
  };
}

describe('VwSurface', () => {
  test('default focusPolicy is output-only and vwLabel is runner', () => {
    const s = createVwSurface();
    expect(s.focusPolicy).toBe('output-only');
    expect(s.vwLabel).toBe('runner');
  });

  test('custom focusPolicy + vwLabel propagate to snapshot', () => {
    const s = createVwSurface({ focusPolicy: 'interactive', vwLabel: 'build' });
    s.attach(fakeHandle());
    const snap = s.snapshot()!;
    expect(snap.focusPolicy).toBe('interactive');
    expect(snap.vwLabel).toBe('build');
    expect(snap.exposure).toEqual({
      userExposure: 'user-interactive',
      agentInteractive: true,
    });
  });

  test('snapshot includes bookmark from the attached handle', () => {
    const s = createVwSurface();
    const h = fakeHandle();
    s.attach(h);
    expect(s.snapshot()?.bookmark).toEqual({ row: 3, col: 2, ts: 100, bytes: 50 });
  });

  test('boundary source=timeout sets timedOut=true', () => {
    const s = createVwSurface();
    const h = fakeHandle();
    s.attach(h);
    h.emitBoundary({ kind: 'cmd-end', source: 'timeout', at: 0 });
    const snap = s.snapshot()!;
    expect(snap.timedOut).toBe(true);
    expect(snap.finished).toBe(true);
  });

  test('output-only: Ctrl+C / Ctrl+D / Ctrl+\\\\ pass through, other keys drop', () => {
    const s = createVwSurface({ focusPolicy: 'output-only' });
    const h = fakeHandle();
    s.attach(h);
    expect(s.forwardKeyByte(INTERRUPT_CHORDS.ctrlC)).toBe(true);
    expect(s.forwardKeyByte(INTERRUPT_CHORDS.ctrlD)).toBe(true);
    expect(s.forwardKeyByte(INTERRUPT_CHORDS.ctrlBackslash)).toBe(true);
    expect(s.forwardKeyByte('a')).toBe(false);
    expect(s.forwardKeyByte('\r')).toBe(false);
    expect(h.writes).toEqual([
      INTERRUPT_CHORDS.ctrlC,
      INTERRUPT_CHORDS.ctrlD,
      INTERRUPT_CHORDS.ctrlBackslash,
    ]);
  });

  test('interactive: every byte is forwarded', () => {
    const s = createVwSurface({ focusPolicy: 'interactive' });
    const h = fakeHandle();
    s.attach(h);
    expect(s.forwardKeyByte('a')).toBe(true);
    expect(s.forwardKeyByte('\r')).toBe(true);
    expect(h.writes).toEqual(['a', '\r']);
  });

  test('forwardKeyByte without attached handle is a no-op', () => {
    const s = createVwSurface();
    expect(s.forwardKeyByte(INTERRUPT_CHORDS.ctrlC)).toBe(false);
  });

  test('setFocusPolicy flips behavior at runtime', () => {
    const s = createVwSurface({ focusPolicy: 'output-only' });
    const h = fakeHandle();
    s.attach(h);
    expect(s.forwardKeyByte('x')).toBe(false);
    const prev = s.setFocusPolicy('interactive');
    expect(prev).toBe('output-only');
    expect(s.forwardKeyByte('x')).toBe(true);
    expect(h.writes).toEqual(['x']);
  });

  test('setFocusPolicy emits an update snapshot', () => {
    const seen: any[] = [];
    const s = createVwSurface({ onUpdate: (snap) => seen.push({ ...snap }) });
    s.attach(fakeHandle());
    const before = seen.length;
    s.setFocusPolicy('interactive');
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)?.focusPolicy).toBe('interactive');
    expect(seen.at(-1)?.exposure).toEqual({
      userExposure: 'user-interactive',
      agentInteractive: true,
    });
  });

  test('completed handle disables keyboard forwarding even when focusPolicy was interactive', () => {
    const s = createVwSurface({ focusPolicy: 'interactive' });
    const h = fakeHandle();
    s.attach(h);
    h.emitStatus('completed');
    expect(s.forwardKeyByte('x')).toBe(false);
    expect(h.writes).toEqual([]);
  });

  test('detach preserves focusPolicy + no forward afterward', () => {
    const s = createVwSurface({ focusPolicy: 'interactive' });
    const h = fakeHandle();
    s.attach(h);
    s.detach();
    expect(s.focusPolicy).toBe('interactive');
    expect(s.forwardKeyByte('x')).toBe(false);
  });

  test('re-attach resets counters but keeps focusPolicy', () => {
    const s = createVwSurface({ focusPolicy: 'interactive' });
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    s.attach(h1);
    h1.emitChunk({ stream: 'pty', bytes: 'stale', ts: 0 });
    s.attach(h2);
    expect(s.focusPolicy).toBe('interactive');
    expect(s.snapshot()?.totalBytes).toBe(0);
  });

  test('kind is "vw"', () => {
    expect(createVwSurface().kind).toBe('vw');
  });
});
