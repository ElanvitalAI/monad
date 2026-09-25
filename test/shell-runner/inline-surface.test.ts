import { describe, test, expect } from 'bun:test';

import { createInlineSurface } from '../../src/shell-runner/inline-surface.js';
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
} {
  const chunkSubs = new Set<(c: OutputChunk) => void>();
  const statusSubs = new Set<(s: ShellStatus) => void>();
  const boundarySubs = new Set<(ev: BoundaryEvent) => void>();
  let status: ShellStatus = 'running';
  const bookmark: BufferMark = { row: 0, col: 0, ts: 0, bytes: 0 };
  const result = new Promise<ShellResult>(() => { /* never */ });
  return {
    id: 'h-fake',
    mode: 'inline',
    get status() { return status; },
    bookmark,
    kill() { /* noop */ },
    background() { return false; },
    promote() { return false; },
    write() { /* noop */ },
    resize() { /* noop */ },
    onChunk(cb) { chunkSubs.add(cb); return (() => chunkSubs.delete(cb)) as Unsubscribe; },
    onStatus(cb) { statusSubs.add(cb); return (() => statusSubs.delete(cb)) as Unsubscribe; },
    onBoundary(cb) { boundarySubs.add(cb); return (() => boundarySubs.delete(cb)) as Unsubscribe; },
    result,
    emitChunk(c) { for (const cb of chunkSubs) cb(c); },
    emitStatus(s) { status = s; for (const cb of statusSubs) cb(s); },
    emitBoundary(ev) { for (const cb of boundarySubs) cb(ev); },
  };
}

function chunk(bytes: string, stream: 'stdout' | 'stderr' = 'stdout'): OutputChunk {
  return { stream, bytes, ts: 0 };
}

describe('InlineSurface', () => {
  test('attach emits an initial snapshot', () => {
    const seen: any[] = [];
    const s = createInlineSurface({ onUpdate: (snap) => seen.push({ ...snap }) });
    s.attach(fakeHandle());
    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe('running');
    expect(seen[0]?.finished).toBe(false);
    expect(seen[0]?.stdoutTail).toEqual([]);
  });

  test('chunks update stdoutTail line-by-line', () => {
    const s = createInlineSurface();
    const h = fakeHandle();
    s.attach(h);
    h.emitChunk(chunk('hello\n'));
    h.emitChunk(chunk('world\n'));
    expect(s.latest()?.stdoutTail).toEqual(['hello', 'world']);
  });

  test('partial line (no newline) shows as last tail row', () => {
    const s = createInlineSurface();
    const h = fakeHandle();
    s.attach(h);
    h.emitChunk(chunk('partial'));
    const snap = s.latest()!;
    expect(snap.stdoutTail).toEqual(['partial']);
    // Next chunk finishes the line — now fully captured.
    h.emitChunk(chunk(' done\n'));
    expect(s.latest()?.stdoutTail).toEqual(['partial done']);
  });

  test('tail ring caps at tailLines (default 5)', () => {
    const s = createInlineSurface();
    const h = fakeHandle();
    s.attach(h);
    for (let i = 0; i < 8; i++) h.emitChunk(chunk(`line ${i}\n`));
    expect(s.latest()?.stdoutTail).toEqual([
      'line 3', 'line 4', 'line 5', 'line 6', 'line 7',
    ]);
  });

  test('stderr goes to stderrTail, stdout to stdoutTail', () => {
    const s = createInlineSurface();
    const h = fakeHandle();
    s.attach(h);
    h.emitChunk(chunk('OUT\n', 'stdout'));
    h.emitChunk(chunk('ERR\n', 'stderr'));
    expect(s.latest()?.stdoutTail).toEqual(['OUT']);
    expect(s.latest()?.stderrTail).toEqual(['ERR']);
  });

  test('cmd-end boundary flips finished=true and captures exit code', () => {
    const s = createInlineSurface();
    const h = fakeHandle();
    s.attach(h);
    h.emitBoundary({ kind: 'cmd-end', source: 'osc-133', at: 0, exitCode: 42 });
    const snap = s.latest()!;
    expect(snap.finished).toBe(true);
    expect(snap.exitCode).toBe(42);
    expect(snap.headline).toContain('exit=42');
  });

  test('status change updates headline glyph', () => {
    const collected: string[] = [];
    const s = createInlineSurface({ onUpdate: (snap) => collected.push(snap.headline) });
    const h = fakeHandle();
    s.attach(h);
    h.emitStatus('backgrounded');
    expect(collected.at(-1)).toContain('⇣');
    h.emitStatus('completed');
    expect(collected.at(-1)).toContain('✓'); // no exit code yet → assume success glyph
  });

  test('detach unsubscribes — subsequent events do not update latest', () => {
    const seen: any[] = [];
    const s = createInlineSurface({ onUpdate: (snap) => seen.push({ ...snap }) });
    const h = fakeHandle();
    s.attach(h);
    const beforeDetach = seen.length;
    s.detach();
    h.emitChunk(chunk('after-detach\n'));
    h.emitStatus('completed');
    expect(seen.length).toBe(beforeDetach);
    // latest() still exposes the last pre-detach snapshot.
    expect(s.latest()).not.toBeNull();
  });

  test('re-attach resets tail rings + timer', () => {
    const s = createInlineSurface();
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    s.attach(h1);
    h1.emitChunk(chunk('stale\n'));
    expect(s.latest()?.stdoutTail).toEqual(['stale']);
    s.attach(h2);
    expect(s.latest()?.stdoutTail).toEqual([]);
    expect(s.latest()?.totalBytes).toBe(0);
  });

  test('onUpdate throw is isolated (doesn\'t break subsequent emits)', () => {
    let threw = 0;
    const s = createInlineSurface({
      onUpdate: () => { threw++; throw new Error('bad'); },
    });
    const h = fakeHandle();
    s.attach(h);
    h.emitChunk(chunk('a\n'));
    h.emitChunk(chunk('b\n'));
    expect(threw).toBeGreaterThanOrEqual(3); // attach + 2 chunks
  });
});
