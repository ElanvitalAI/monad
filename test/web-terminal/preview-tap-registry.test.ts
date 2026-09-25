// WT-S-1 — preview-tap-registry: PreviewTerminal.addRawOutputTap →
// AcpServerHandle.terminalOutput fan-out.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  registerPreviewTerminalForWebTap,
  unregisterPreviewTerminalForWebTap,
  getRegisteredPreviewTerminalCount,
  lookupPreviewTerminal,
  listPreviewTerminals,
  __resetPreviewTapRegistry,
} from '../../src/web-terminal/preview-tap-registry';
import type { AcpServerHandle } from '../../src/acp/server';

interface FakePreviewTerminal {
  addRawOutputTap(cb: (chunk: string) => void): () => void;
  emit(chunk: string): void;
  // WT-S-2 — list response getters. Defaults match the typical
  // dashboard PreviewTerminal so tests don't have to set them when not
  // asserting on the metadata payload.
  pid: number;
  cols: number;
  rows: number;
  isAlive: boolean;
}

function fakePreviewTerminal(opts: Partial<{
  pid: number; cols: number; rows: number; isAlive: boolean;
}> = {}): FakePreviewTerminal {
  const taps = new Set<(chunk: string) => void>();
  return {
    addRawOutputTap(cb) {
      taps.add(cb);
      return () => { taps.delete(cb); };
    },
    emit(chunk) { for (const cb of taps) cb(chunk); },
    pid: opts.pid ?? 4242,
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    isAlive: opts.isAlive ?? true,
  };
}

function fakeHandle(): {
  handle: AcpServerHandle;
  outputs: Array<{ sessionId: string; terminalId: string; data: string }>;
  exits: Array<{ sessionId: string; terminalId: string; code: number }>;
} {
  const outputs: Array<{ sessionId: string; terminalId: string; data: string }> = [];
  const exits: Array<{ sessionId: string; terminalId: string; code: number }> = [];
  const handle: AcpServerHandle = {
    notify: async () => {},
    block: async () => {},
    showModal: async () => true,
    showToast: async () => true,
    updateStatusPill: async () => true,
    terminalOutput: async (sessionId, terminalId, data) => {
      outputs.push({ sessionId, terminalId, data });
      return true;
    },
    terminalExit: async (sessionId, terminalId, code) => {
      exits.push({ sessionId, terminalId, code });
      return true;
    },
    terminalInputActivity: async () => true,
    uiCapabilities: () => ({
      showModal: false, showToast: false, updateStatusPill: false, usage: false,
    }),
    termCapabilities: () => ({ terminalOutput: true, terminalExit: true }),
    sessionIds: () => [],
  };
  return { handle, outputs, exits };
}

afterEach(() => { __resetPreviewTapRegistry(); });

describe('preview-tap-registry', () => {
  test('register fans raw chunks to handle.terminalOutput', () => {
    const pt = fakePreviewTerminal();
    const { handle, outputs } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's1', 'preview-1', handle);
    pt.emit('hello\n');
    pt.emit('world\r\n');
    expect(outputs).toEqual([
      { sessionId: 's1', terminalId: 'preview-1', data: 'hello\n' },
      { sessionId: 's1', terminalId: 'preview-1', data: 'world\r\n' },
    ]);
  });

  test('count tracks lifecycle', () => {
    const a = fakePreviewTerminal();
    const b = fakePreviewTerminal();
    const { handle } = fakeHandle();
    expect(getRegisteredPreviewTerminalCount()).toBe(0);
    registerPreviewTerminalForWebTap(a as any, 's', 'a', handle);
    registerPreviewTerminalForWebTap(b as any, 's', 'b', handle);
    expect(getRegisteredPreviewTerminalCount()).toBe(2);
    unregisterPreviewTerminalForWebTap(a as any);
    expect(getRegisteredPreviewTerminalCount()).toBe(1);
  });

  test('re-register replaces prior tap (idempotent · no double-fan)', () => {
    const pt = fakePreviewTerminal();
    const { handle, outputs } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's', 'a', handle);
    registerPreviewTerminalForWebTap(pt as any, 's', 'b', handle);
    pt.emit('x');
    expect(outputs).toEqual([
      { sessionId: 's', terminalId: 'b', data: 'x' },
    ]);
  });

  test('unregister stops the fan-out', () => {
    const pt = fakePreviewTerminal();
    const { handle, outputs } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's', 'a', handle);
    pt.emit('hit');
    unregisterPreviewTerminalForWebTap(pt as any);
    pt.emit('miss');
    expect(outputs.map((o) => o.data)).toEqual(['hit']);
  });

  test('unregister on unknown terminal is a no-op', () => {
    const pt = fakePreviewTerminal();
    expect(() => unregisterPreviewTerminalForWebTap(pt as any)).not.toThrow();
  });

  test('returned thunk also unregisters', () => {
    const pt = fakePreviewTerminal();
    const { handle, outputs } = fakeHandle();
    const off = registerPreviewTerminalForWebTap(pt as any, 's', 'a', handle);
    pt.emit('one');
    off();
    pt.emit('two');
    expect(outputs.map((o) => o.data)).toEqual(['one']);
  });
});

describe('lookupPreviewTerminal (WT-A-1)', () => {
  test('returns null when nothing registered', () => {
    expect(lookupPreviewTerminal('s', 'preview-1')).toBeNull();
  });

  test('returns instance after register', () => {
    const a = fakePreviewTerminal();
    const b = fakePreviewTerminal();
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(a as any, 's', 'preview-1', handle);
    registerPreviewTerminalForWebTap(b as any, 's', 'preview-2', handle);
    expect(lookupPreviewTerminal('s', 'preview-1')).toBe(a as any);
    expect(lookupPreviewTerminal('s', 'preview-2')).toBe(b as any);
  });

  test('different sessions are isolated', () => {
    const pt = fakePreviewTerminal();
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's1', 'preview-1', handle);
    expect(lookupPreviewTerminal('s2', 'preview-1')).toBeNull();
    expect(lookupPreviewTerminal('s1', 'preview-1')).toBe(pt as any);
  });

  test('unregister clears the lookup', () => {
    const pt = fakePreviewTerminal();
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', handle);
    expect(lookupPreviewTerminal('s', 'preview-1')).toBe(pt as any);
    unregisterPreviewTerminalForWebTap(pt as any);
    expect(lookupPreviewTerminal('s', 'preview-1')).toBeNull();
  });
});

describe('listPreviewTerminals (WT-S-2)', () => {
  test('returns empty array when nothing registered', () => {
    expect(listPreviewTerminals('s')).toEqual([]);
  });

  test('lists only terminals registered against the given sessionId', () => {
    const a = fakePreviewTerminal({ pid: 100, cols: 80, rows: 24 });
    const b = fakePreviewTerminal({ pid: 200, cols: 120, rows: 40 });
    const c = fakePreviewTerminal({ pid: 300, cols: 100, rows: 30 });
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(a as any, 's1', 'preview-1', handle);
    registerPreviewTerminalForWebTap(b as any, 's1', 'preview-2', handle);
    registerPreviewTerminalForWebTap(c as any, 's2', 'preview-1', handle);

    const s1 = listPreviewTerminals('s1');
    expect(s1).toHaveLength(2);
    expect(s1.map((e) => e.terminalId).sort()).toEqual(['preview-1', 'preview-2']);
    const entry1 = s1.find((e) => e.terminalId === 'preview-1');
    expect(entry1).toMatchObject({ pid: 100, cols: 80, rows: 24, isAlive: true });

    expect(listPreviewTerminals('s2')).toHaveLength(1);
    expect(listPreviewTerminals('unknown')).toEqual([]);
  });

  test('reflects unregister', () => {
    const pt = fakePreviewTerminal();
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', handle);
    expect(listPreviewTerminals('s')).toHaveLength(1);
    unregisterPreviewTerminalForWebTap(pt as any);
    expect(listPreviewTerminals('s')).toEqual([]);
  });

  test('reflects isAlive flips (e.g. PTY dead but tap not yet unregistered)', () => {
    const pt = fakePreviewTerminal({ isAlive: true });
    const { handle } = fakeHandle();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', handle);
    expect(listPreviewTerminals('s')[0]?.isAlive).toBe(true);
    pt.isAlive = false;
    expect(listPreviewTerminals('s')[0]?.isAlive).toBe(false);
  });
});
