// WT-C-1 — recording-registry: PreviewTerminal raw tap → asciicast
// recorder + ~/.monad/timelines/<recorderId>.cast write.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  registerPreviewTerminalForWebTap,
  __resetPreviewTapRegistry,
} from '../../src/web-terminal/preview-tap-registry';
import {
  startWebTerminalRecording,
  stopWebTerminalRecording,
  listWebTerminalRecordings,
  abortWebTerminalRecording,
  __resetWebTerminalRecordings,
} from '../../src/web-terminal/recording-registry';
import type { AcpServerHandle } from '../../src/acp/server';

interface FakePreviewTerminal {
  addRawOutputTap(cb: (chunk: string) => void): () => void;
  emit(chunk: string): void;
  pid: number;
  cols: number;
  rows: number;
  isAlive: boolean;
}

function fakePt(opts: Partial<{
  pid: number; cols: number; rows: number; isAlive: boolean;
}> = {}): FakePreviewTerminal {
  const taps = new Set<(chunk: string) => void>();
  return {
    addRawOutputTap(cb) {
      taps.add(cb);
      return () => { taps.delete(cb); };
    },
    emit(chunk) { for (const cb of taps) cb(chunk); },
    pid: opts.pid ?? 1234,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    isAlive: opts.isAlive ?? true,
  };
}

function fakeHandle(): AcpServerHandle {
  return {
    notify: async () => {},
    block: async () => {},
    showModal: async () => true,
    showToast: async () => true,
    updateStatusPill: async () => true,
    terminalOutput: async () => true,
    terminalExit: async () => true,
    uiCapabilities: () => ({
      showModal: false, showToast: false, updateStatusPill: false, usage: false,
    }),
    termCapabilities: () => ({ terminalOutput: true, terminalExit: true }),
    sessionIds: () => [],
  };
}

afterEach(() => {
  __resetWebTerminalRecordings();
  __resetPreviewTapRegistry();
});

describe('recording-registry · start/stop happy path', () => {
  test('captures emitted chunks into asciicast frames + writes via writeCast hook', () => {
    const pt = fakePt({ cols: 100, rows: 30 });
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    let nowMs = 1_700_000_000_000;

    const start = startWebTerminalRecording('s', 'preview-1', {
      now: () => nowMs,
    });
    expect(start.terminalId).toBe('preview-1');
    expect(start.recorderId).toMatch(/^webterm-preview-1-\d+$/);

    nowMs += 100;
    pt.emit('hello\n');
    nowMs += 200;
    pt.emit('world\r\n');

    const written: { path?: string; body?: string } = {};
    const stop = stopWebTerminalRecording('s', 'preview-1', {
      writeCast: (p, body) => {
        written.path = p;
        written.body = body;
      },
    });

    expect(stop.recorderId).toBe(start.recorderId);
    expect(stop.frameCount).toBe(2);
    expect(stop.path).toBe(written.path!);
    expect(written.path!).toMatch(/webterm-preview-1-\d+\.cast$/);

    // Asciicast v2: header line + 2 frame lines
    const body = written.body!;
    expect(body).toBeDefined();
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]!);
    expect(header.version).toBe(2);
    expect(header.width).toBe(100);
    expect(header.height).toBe(30);
    const f1 = JSON.parse(lines[1]!);
    const f2 = JSON.parse(lines[2]!);
    expect(f1[1]).toBe('o');
    expect(f1[2]).toBe('hello\n');
    expect(f2[1]).toBe('o');
    expect(f2[2]).toBe('world\r\n');
  });

  test('chunks emitted before start are NOT recorded', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    pt.emit('before-start\n');

    startWebTerminalRecording('s', 'preview-1', { now: () => 1_700_000_000_000 });
    pt.emit('after-start\n');

    const captured: { body?: string } = {};
    stopWebTerminalRecording('s', 'preview-1', {
      writeCast: (_p, body) => { captured.body = body; },
    });
    const body = captured.body!;
    expect(body).toBeDefined();
    expect(body).toContain('after-start');
    expect(body).not.toContain('before-start');
  });

  test('chunks emitted after stop are NOT recorded', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    let nowMs = 1_700_000_000_000;
    startWebTerminalRecording('s', 'preview-1', { now: () => nowMs });
    nowMs += 100;
    pt.emit('inside\n');

    const captured: { body?: string } = {};
    stopWebTerminalRecording('s', 'preview-1', {
      writeCast: (_p, body) => { captured.body = body; },
    });
    pt.emit('after-stop\n');

    const body = captured.body!;
    expect(body).toBeDefined();
    expect(body).toContain('inside');
    expect(body).not.toContain('after-stop');
  });
});

describe('recording-registry · error paths', () => {
  test('start throws on unknown terminal', () => {
    expect(() => startWebTerminalRecording('s', 'preview-x')).toThrow(/unknown terminal/);
  });

  test('start throws when already recording for same key', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    startWebTerminalRecording('s', 'preview-1');
    expect(() => startWebTerminalRecording('s', 'preview-1')).toThrow(/already active/);
    // cleanup
    stopWebTerminalRecording('s', 'preview-1', { writeCast: () => {} });
  });

  test('stop throws when no recording active', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    expect(() => stopWebTerminalRecording('s', 'preview-1', { writeCast: () => {} }))
      .toThrow(/no active recording/);
  });

  test('different sessions are isolated', () => {
    const a = fakePt();
    const b = fakePt();
    registerPreviewTerminalForWebTap(a as any, 's1', 'preview-1', fakeHandle());
    registerPreviewTerminalForWebTap(b as any, 's2', 'preview-1', fakeHandle());
    startWebTerminalRecording('s1', 'preview-1');
    // Should NOT be considered already-active for s2's terminal:
    expect(() => startWebTerminalRecording('s2', 'preview-1')).not.toThrow();
    // cleanup
    stopWebTerminalRecording('s1', 'preview-1', { writeCast: () => {} });
    stopWebTerminalRecording('s2', 'preview-1', { writeCast: () => {} });
  });
});

describe('recording-registry · list + abort', () => {
  test('list reflects active recordings per session', () => {
    const a = fakePt();
    const b = fakePt();
    registerPreviewTerminalForWebTap(a as any, 's1', 'a', fakeHandle());
    registerPreviewTerminalForWebTap(b as any, 's1', 'b', fakeHandle());
    expect(listWebTerminalRecordings('s1')).toEqual([]);
    startWebTerminalRecording('s1', 'a');
    expect(listWebTerminalRecordings('s1')).toHaveLength(1);
    startWebTerminalRecording('s1', 'b');
    expect(listWebTerminalRecordings('s1')).toHaveLength(2);
    expect(listWebTerminalRecordings('s2')).toEqual([]);

    // status field
    const entry = listWebTerminalRecordings('s1').find((e) => e.terminalId === 'a');
    expect(entry?.status).toBe('recording');

    // cleanup
    stopWebTerminalRecording('s1', 'a', { writeCast: () => {} });
    stopWebTerminalRecording('s1', 'b', { writeCast: () => {} });
  });

  test('abort removes from list without writing cast', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    startWebTerminalRecording('s', 'preview-1');
    expect(listWebTerminalRecordings('s')).toHaveLength(1);

    // abort returns true the first time and is idempotent thereafter.
    expect(abortWebTerminalRecording('s', 'preview-1')).toBe(true);
    expect(listWebTerminalRecordings('s')).toEqual([]);
    expect(abortWebTerminalRecording('s', 'preview-1')).toBe(false);
  });

  test('after abort, start can succeed again', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    startWebTerminalRecording('s', 'preview-1');
    abortWebTerminalRecording('s', 'preview-1');
    expect(() => startWebTerminalRecording('s', 'preview-1')).not.toThrow();
    // cleanup
    stopWebTerminalRecording('s', 'preview-1', { writeCast: () => {} });
  });
});
