// ── V3 pty-tail PaneContent tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { renderTail, createPtyTailPaneContent } from '../src/virtual-windows/pty-tail-content';
import { setPtyAdapterForTesting, resetForTesting, startPty, getPty, type PtyHandle } from '../src/pty-shell/registry';

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── renderTail (pure) ──────────────────────────────────────────────

describe('renderTail', () => {
  function mkHandle(snap: string, alive: boolean, cmd = 'bun test'): Pick<PtyHandle, 'snapshot' | 'id' | 'cmd' | 'isAlive' | 'exitCode' | 'startedAt'> {
    return {
      id: 'pty_test01',
      cmd,
      startedAt: Date.now() - 5000,
      exitCode: alive ? null : 0,
      isAlive: () => alive,
      snapshot: () => snap,
    };
  }

  test('header shows compact running status + age + cmd', () => {
    const out = strip(renderTail(mkHandle('hello\n', true), 80, 5, 0));
    expect(out).toContain('running');
    expect(out).toContain('5s');
    expect(out).toContain('bun test');
    expect(out).not.toContain('pty_test01');
  });

  test('exited header shows exit status', () => {
    const out = strip(renderTail(mkHandle('done\n', false), 80, 5, 0));
    expect(out).toContain('exited 0');
  });

  test('tail lines padded to bodyRows when snapshot shorter', () => {
    const out = renderTail(mkHandle('line1\nline2\n', true), 80, 6, 0);
    const rows = out.split('\n');
    expect(rows.length).toBe(6);
    // line1 + line2 sit on the bottom two content rows (header + 3 blank + 2 content)
    expect(rows[rows.length - 1]).toContain('line2');
    expect(rows[rows.length - 2]).toContain('line1');
  });

  test('scrollOffset 0 = live tail (bottom)', () => {
    const snap = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const out = renderTail(mkHandle(snap, true), 80, 5, 0);
    const rows = out.split('\n');
    // bodyRows = 4; should show line17..line20 on the last 4 rows
    expect(rows[rows.length - 1]).toContain('line20');
    expect(rows[1]).toContain('line17');
  });

  test('scrollOffset > 0 shifts view upward', () => {
    const snap = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const out = renderTail(mkHandle(snap, true), 80, 5, 3);
    const rows = out.split('\n');
    // bodyRows = 4; shifted up by 3 → shows line14..line17
    expect(rows[rows.length - 1]).toContain('line17');
    expect(rows[1]).toContain('line14');
  });

  test('scrollOffset larger than scrollable snaps to oldest content', () => {
    const snap = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const out = renderTail(mkHandle(snap, true), 80, 5, 9999);
    const rows = out.split('\n');
    // bodyRows = 4; snapshot has 10 lines — oldest 4 should show
    expect(rows[1]).toContain('line1');
    expect(rows[rows.length - 1]).toContain('line4');
  });

  test('very long cmd is truncated in header', () => {
    const longCmd = 'a'.repeat(200);
    const out = strip(renderTail(mkHandle('x\n', true, longCmd), 60, 3, 0));
    expect(out).toContain('…');
  });

  test('narrow header drops cmd and keeps status + age only', () => {
    const out = strip(renderTail(mkHandle('x\n', true, 'bun run src/index.ts'), 24, 3, 0));
    expect(out).toContain('running');
    expect(out).toContain('5s');
    expect(out).not.toContain('bun run src/index.ts');
  });
});

// ─── createPtyTailPaneContent (integration with registry) ───────────

describe('createPtyTailPaneContent (integration)', () => {
  beforeEach(() => {
    resetForTesting();
    // Inject a fake PTY adapter so tests don't need the native node-pty.
    setPtyAdapterForTesting(() => {
      let onData: ((d: string) => void) | null = null;
      let onExit: ((e: { exitCode: number; signal?: number }) => void) | null = null;
      return {
        pid: 1,
        write: () => {},
        kill: () => { onExit?.({ exitCode: 0 }); },
        onData(cb) { onData = cb; return { dispose: () => { onData = null; } }; },
        onExit(cb) { onExit = cb; return { dispose: () => { onExit = null; } }; },
      };
    });
  });

  afterEach(() => {
    resetForTesting();
    setPtyAdapterForTesting(null);
  });

  test('renders (pty gone) when ptyId unknown', () => {
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: 'pty_nope' });
    const out = strip(content.render({ cols: 40, rows: 4, focused: true }));
    expect(out).toContain('pty_nope gone');
  });

  test('title defaults to "pty:<id>" and can be overridden', () => {
    const a = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: 'pty_x' });
    expect(a.title).toBe('pty:pty_x');
    const b = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: 'pty_x', title: 'dev-server' });
    expect(b.title).toBe('dev-server');
  });

  test('render shows snapshot of live handle', () => {
    const h = startPty({ cmd: 'sleep 1' });
    h.appendOutput('hello world\n');
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: h.id });
    const out = strip(content.render({ cols: 80, rows: 5, focused: true }));
    expect(out).toContain('hello world');
    expect(out).toContain('running');
  });

  test('j/k scrolls without forwarding to stdin', () => {
    const h = startPty({ cmd: 'sleep 1' });
    let writes = '';
    const origWrite = h.write;
    h.write = (s: string) => { writes += s; origWrite.call(h, s); };
    for (let i = 0; i < 20; i++) h.appendOutput(`line${i}\n`);
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: h.id });

    const act = content.onKey({ name: 'k' } as any);
    expect(act.type).toBe('refresh');
    expect(writes).toBe('');

    const act2 = content.onKey({ name: 'j' } as any);
    expect(act2.type).toBe('refresh');
    expect(writes).toBe('');
  });

  test('regular keystroke forwards to PTY stdin and drops scroll to tail', () => {
    const h = startPty({ cmd: 'cat' });
    let writes = '';
    const origWrite = h.write;
    h.write = (s: string) => { writes += s; origWrite.call(h, s); };
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: h.id });
    content.onKey({ name: 'k' } as any); // scroll up
    const act = content.onKey({ name: 'a' } as any);
    expect(act.type).toBe('refresh');
    expect(writes).toBe('a');
  });

  test('dispose stops the polling timer', () => {
    const h = startPty({ cmd: 'sleep 1' });
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: h.id, refreshMs: 10 });
    content.start();
    content.dispose();
    // After dispose, isAlive on pane reports false even though PTY lives.
    expect(content.isAlive).toBe(false);
  });

  test('capture returns snapshot bytes for observer tools', () => {
    const h = startPty({ cmd: 'sleep 1' });
    h.appendOutput('ABC');
    const content = createPtyTailPaneContent({ kind: 'pty-tail', ptyId: h.id });
    expect(content.capture()).toBe('ABC');
  });
});
