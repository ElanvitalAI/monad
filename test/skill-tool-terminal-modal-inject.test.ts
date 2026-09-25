import { describe, expect, test } from 'bun:test';

import {
  buildTerminalModalInjectTool,
  dispatchTerminalModalInject,
  autoApprover,
  KEY_BYTES,
} from '../src/skills/tools/terminal-modal-inject.js';
import { TerminalSessionRegistry } from '../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminalOpts, PreviewTerminal } from '../src/preview/terminal.js';

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal & { _writes: string[] } {
  let alive = false;
  const writes: string[] = [];
  return {
    _writes: writes,
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (b: string) => writes.push(b),
    resize: () => {},
    render: () => '',
    cursorPosition: () => alive ? ({ row: 0, col: 0 }) : null,
    get isAlive(): boolean { return alive; },
    cols: opts.cols,
    rows: opts.rows,
    pid: 1,
    isScrolledBack: false,
    scrollbackOffset: 0,
    wantsMouse: false,
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
  } as unknown as PreviewTerminal & { _writes: string[] };
}

function makeRegistry() {
  return new TerminalSessionRegistry({
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    terminalFactory: fakePreview,
  });
}

describe('terminal_modal_inject', () => {
  test('schema mentions input + key', () => {
    const t = buildTerminalModalInjectTool();
    const p = t.parameters.properties as Record<string, unknown>;
    expect(p.input).toBeDefined();
    expect(p.key).toBeDefined();
  });

  test('rejects when no approver is wired (fail-closed)', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await expect(dispatchTerminalModalInject(
      { id: s.id, input: 'hi' },
      { registry },
    )).rejects.toThrow(/no approver/);
  });

  test('input text writes to PTY when approver accepts', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const r = await dispatchTerminalModalInject(
      { id: s.id, input: 'yes\r' },
      { registry, approver: autoApprover(), chunkDelayMs: 0 },
    );
    const writes = (s.preview as unknown as { _writes: string[] })._writes;
    expect(writes).toContain('yes\r');
    expect(r.output).toMatch(/bytes_sent=4/);
  });

  test('approver rejection throws', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await expect(dispatchTerminalModalInject(
      { id: s.id, input: 'x' },
      { registry, approver: async () => false, chunkDelayMs: 0 },
    )).rejects.toThrow(/rejected/);
  });

  test('named key Enter → \\r', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await dispatchTerminalModalInject(
      { id: s.id, key: 'Enter' },
      { registry, approver: autoApprover(), chunkDelayMs: 0 },
    );
    const writes = (s.preview as unknown as { _writes: string[] })._writes;
    expect(writes).toContain('\r');
  });

  test('named key C-c → \\x03', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await dispatchTerminalModalInject(
      { id: s.id, key: 'C-c' },
      { registry, approver: autoApprover(), chunkDelayMs: 0 },
    );
    const writes = (s.preview as unknown as { _writes: string[] })._writes;
    expect(writes).toContain('\x03');
  });

  test('unknown key rejects', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await expect(dispatchTerminalModalInject(
      { id: s.id, key: 'NotAKey' },
      { registry, approver: autoApprover(), chunkDelayMs: 0 },
    )).rejects.toThrow(/unknown key/);
  });

  test('input + key are mutually exclusive', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    await expect(dispatchTerminalModalInject(
      { id: s.id, input: 'x', key: 'Enter' },
      { registry, approver: autoApprover() },
    )).rejects.toThrow(/mutually exclusive/);
  });

  test('unknown session id rejects', async () => {
    const registry = makeRegistry();
    await expect(dispatchTerminalModalInject(
      { id: 'nope', input: 'x' },
      { registry, approver: autoApprover() },
    )).rejects.toThrow(/unknown/);
  });

  test('exited session rejects', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    registry.kill(s.id);
    await expect(dispatchTerminalModalInject(
      { id: s.id, input: 'x' },
      { registry, approver: autoApprover() },
    )).rejects.toThrow(/exited/);
  });

  test('large input chunks through write (256B chunks)', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 't', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const payload = 'a'.repeat(600);
    await dispatchTerminalModalInject(
      { id: s.id, input: payload },
      { registry, approver: autoApprover(), chunkDelayMs: 0 },
    );
    const writes = (s.preview as unknown as { _writes: string[] })._writes;
    // 600 bytes / 256 = 3 chunks (256, 256, 88)
    expect(writes.length).toBe(3);
    expect(writes.join('').length).toBe(600);
  });

  test('approver sees preview of input', async () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 'target', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    let seenTitle = '';
    await dispatchTerminalModalInject(
      { id: s.id, input: 'rm -rf /' },
      {
        registry,
        approver: async (req) => { seenTitle = req.sessionTitle; return false; },
        chunkDelayMs: 0,
      },
    ).catch(() => {});
    expect(seenTitle).toBe('target');
  });
});

describe('KEY_BYTES', () => {
  test('includes common control keys', () => {
    expect(KEY_BYTES.Enter).toBe('\r');
    expect(KEY_BYTES.Escape).toBe('\x1b');
    expect(KEY_BYTES.Tab).toBe('\t');
  });
});

describe('catalog registration', () => {
  test('terminal_modal_inject is registered with minTier T2', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const e = nativeToolCatalog.find(t => t.id === 'terminal_modal_inject');
    expect(e).toBeDefined();
    expect(e!.minTier).toBe('T2');
    expect(e!.safety).toContain('mutating');
    expect(e!.probe?.onFail).toBe('hide');
  });
});
