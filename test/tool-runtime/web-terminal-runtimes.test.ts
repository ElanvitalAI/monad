// WT-L-1 — LLM tool dispatchers for web-terminal kind.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  registerPreviewTerminalForWebTap,
  __resetPreviewTapRegistry,
} from '../../src/web-terminal/preview-tap-registry';
import {
  dispatchWebTerminalList,
  dispatchWebTerminalSnapshot,
  dispatchWebTerminalInput,
  buildWebTerminalListTool,
  buildWebTerminalSnapshotTool,
  buildWebTerminalInputTool,
  webTerminalListRuntime,
  webTerminalSnapshotRuntime,
  webTerminalInputRuntime,
} from '../../src/tool-runtime/web-terminal-runtimes';
import type { AcpServerHandle } from '../../src/acp/server';

interface FakePT {
  addRawOutputTap: (cb: (chunk: string) => void) => () => void;
  emit: (chunk: string) => void;
  pid: number;
  cols: number;
  rows: number;
  isAlive: boolean;
  renderForLLM: () => string;
  write: (data: string) => void;
  writes: string[];
}

function fakePt(opts: Partial<{
  pid: number; cols: number; rows: number; isAlive: boolean; rendered: string;
}> = {}): FakePT {
  const taps = new Set<(chunk: string) => void>();
  const writes: string[] = [];
  return {
    addRawOutputTap(cb) {
      taps.add(cb);
      return () => { taps.delete(cb); };
    },
    emit(chunk) { for (const cb of taps) cb(chunk); },
    write(data) { writes.push(data); },
    pid: opts.pid ?? 9999,
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 30,
    isAlive: opts.isAlive ?? true,
    renderForLLM: () => opts.rendered ?? '',
    writes,
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
    terminalInputActivity: async () => true,
    uiCapabilities: () => ({
      showModal: false, showToast: false, updateStatusPill: false, usage: false,
    }),
    termCapabilities: () => ({ terminalOutput: true, terminalExit: true }),
    sessionIds: () => [],
  };
}

afterEach(() => __resetPreviewTapRegistry());

describe('WebTerminalList', () => {
  test('tool spec shape — sessionId no longer required (auto-injected)', () => {
    const spec = buildWebTerminalListTool();
    expect(spec.name).toBe('WebTerminalList');
    expect(spec.parameters).toBeDefined();
    const required = (spec.parameters as { required?: string[] }).required ?? [];
    expect(required).not.toContain('sessionId');
    // sessionId still listed in properties so explicit override is possible.
    const props = (spec.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.sessionId).toBeDefined();
  });

  test('throws when neither args.sessionId nor opts.sessionId present', () => {
    expect(() => dispatchWebTerminalList({})).toThrow(/sessionId required/);
  });

  test('returns empty list when nothing registered', () => {
    const r = dispatchWebTerminalList({ sessionId: 's1' });
    expect(r.terminals).toEqual([]);
  });

  test('opts.sessionId fills in when args.sessionId missing', () => {
    const r = dispatchWebTerminalList({}, { sessionId: 's-from-ctx' });
    expect(r.sessionId).toBe('s-from-ctx');
  });

  test('args.sessionId wins over opts.sessionId (explicit override)', () => {
    const r = dispatchWebTerminalList({ sessionId: 's-explicit' }, { sessionId: 's-from-ctx' });
    expect(r.sessionId).toBe('s-explicit');
  });

  test('returns sessionId-scoped registered terminals', () => {
    const a = fakePt({ pid: 100, cols: 80, rows: 24 });
    const b = fakePt({ pid: 200, cols: 120, rows: 40 });
    registerPreviewTerminalForWebTap(a as any, 's1', 'preview-1', fakeHandle());
    registerPreviewTerminalForWebTap(b as any, 's2', 'preview-2', fakeHandle());

    const r = dispatchWebTerminalList({ sessionId: 's1' });
    expect(r.terminals).toHaveLength(1);
    expect(r.terminals[0]?.terminalId).toBe('preview-1');
    expect(r.terminals[0]?.pid).toBe(100);
  });

  test('runtime returns stringified JSON', async () => {
    const rt = webTerminalListRuntime();
    const out = await rt.run({ sessionId: 's' }, { surface: 'skill' });
    const parsed = JSON.parse(out.output);
    expect(parsed.sessionId).toBe('s');
    expect(parsed.terminals).toEqual([]);
  });
});

describe('WebTerminalSnapshot', () => {
  test('tool spec shape — only terminalId required', () => {
    const spec = buildWebTerminalSnapshotTool();
    expect(spec.name).toBe('WebTerminalSnapshot');
    expect((spec.parameters as { required?: string[] }).required).toEqual(['terminalId']);
  });

  test('opts.sessionId fills in when args.sessionId missing', () => {
    const pt = fakePt({ rendered: 'hi' });
    registerPreviewTerminalForWebTap(pt as any, 's-ctx', 'preview-1', fakeHandle());
    const r = dispatchWebTerminalSnapshot(
      { terminalId: 'preview-1' },
      { sessionId: 's-ctx' },
    );
    expect(r.sessionId).toBe('s-ctx');
    expect(r.text).toBe('hi');
  });

  test('throws on unknown terminal', () => {
    expect(() => dispatchWebTerminalSnapshot({ sessionId: 's', terminalId: 'preview-1' }))
      .toThrow(/unknown terminal/);
  });

  test('returns rendered text + dims', () => {
    const pt = fakePt({ rendered: 'hello world\nlast line', cols: 80, rows: 24 });
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());

    const r = dispatchWebTerminalSnapshot({ sessionId: 's', terminalId: 'preview-1' });
    expect(r.text).toBe('hello world\nlast line');
    expect(r.bytes).toBe(21);
    expect(r.cols).toBe(80);
    expect(r.rows).toBe(24);
  });

  test('runtime stringifies snapshot', async () => {
    const pt = fakePt({ rendered: 'abc' });
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    const rt = webTerminalSnapshotRuntime();
    const out = await rt.run({ sessionId: 's', terminalId: 'preview-1' }, { surface: 'skill' });
    const parsed = JSON.parse(out.output);
    expect(parsed.text).toBe('abc');
    expect(parsed.bytes).toBe(3);
  });
});

describe('WebTerminalInput', () => {
  test('tool spec shape — terminalId + data required, sessionId auto-injected', () => {
    const spec = buildWebTerminalInputTool();
    expect(spec.name).toBe('WebTerminalInput');
    expect((spec.parameters as { required?: string[] }).required).toEqual(['terminalId', 'data']);
  });

  test('opts.sessionId fills in when args.sessionId missing', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's-ctx', 'preview-1', fakeHandle());
    const r = dispatchWebTerminalInput(
      { terminalId: 'preview-1', data: 'x' },
      { sessionId: 's-ctx' },
    );
    expect(r.sessionId).toBe('s-ctx');
    expect(pt.writes).toEqual(['x']);
  });

  test('throws on empty data', () => {
    expect(() => dispatchWebTerminalInput({
      sessionId: 's', terminalId: 'preview-1', data: '',
    })).toThrow(/non-empty/);
  });

  test('throws on unknown terminal', () => {
    expect(() => dispatchWebTerminalInput({
      sessionId: 's', terminalId: 'no-such', data: 'ls\n',
    })).toThrow(/unknown terminal/);
  });

  test('writes data to PTY + returns byte count', () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    const r = dispatchWebTerminalInput({
      sessionId: 's', terminalId: 'preview-1', data: 'echo hi\n',
    });
    expect(r.bytes).toBe(8);
    expect(pt.writes).toEqual(['echo hi\n']);
  });

  test('runtime stringifies result', async () => {
    const pt = fakePt();
    registerPreviewTerminalForWebTap(pt as any, 's', 'preview-1', fakeHandle());
    const rt = webTerminalInputRuntime();
    const out = await rt.run({ sessionId: 's', terminalId: 'preview-1', data: 'x' }, { surface: 'skill' });
    const parsed = JSON.parse(out.output);
    expect(parsed.bytes).toBe(1);
    expect(pt.writes).toEqual(['x']);
  });
});
