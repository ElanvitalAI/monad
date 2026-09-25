import { describe, expect, test } from 'bun:test';

import {
  createPaneContent,
  registerPaneContentKind,
  createTerminalPaneContent,
  createMarkdownPaneContent,
  createLLMChatPaneContent,
  createScratchPaneContent,
  type PaneContent,
} from '../src/virtual-windows/pane-content.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../src/preview/terminal.js';

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  const writes: string[] = [];
  return {
    _writes: writes,
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: (b: string) => writes.push(b),
    resize: () => {},
    render: () => 'shell-grid',
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

describe('factory dispatch', () => {
  test('creates content for each built-in kind', () => {
    const mark = createPaneContent({ kind: 'markdown', text: 'hi' });
    expect(mark.kind).toBe('markdown');
    const sc = createPaneContent({ kind: 'scratch' });
    expect(sc.kind).toBe('scratch');
    const chat = createPaneContent({ kind: 'llm-chat', provider: 'grok' });
    expect(chat.kind).toBe('llm-chat');
  });

  test('unknown kind throws', () => {
    expect(() => createPaneContent({ kind: 'nonexistent' } as unknown as { kind: 'markdown'; text: string }))
      .toThrow(/unknown pane content kind/);
  });

  test('registerPaneContentKind adds custom kinds', () => {
    registerPaneContentKind('custom-test', ((s, _d) => ({
      id: 'test1', kind: 'custom-test', title: 'custom',
      focusPolicy: 'interactive' as const,
      start: () => {}, stop: () => {},
      render: () => 'x',
      onKey: () => ({ type: 'none' as const }),
      write: () => {},
      capture: () => 'captured',
      isAlive: true,
      on: () => () => {},
      dispose: () => {},
    })) as any);
    const p = createPaneContent({ kind: 'custom-test' } as unknown as { kind: 'markdown'; text: string });
    expect(p.kind).toBe('custom-test');
  });
});

describe('terminal pane content', () => {
  test('start spawns preview + types cmd', () => {
    let captured: any;
    const pane = createTerminalPaneContent({
      kind: 'terminal', cmd: 'ls', cwd: '/tmp',
    }, { terminalFactory: (o) => { const pt = fakePreview(o); captured = pt; return pt; } });
    pane.start();
    expect(captured.isAlive).toBe(true);
    expect(captured._writes).toContain('ls\r');
  });

  test('render delegates to preview.render', () => {
    const pane = createTerminalPaneContent({
      kind: 'terminal', cmd: 'sh',
    }, { terminalFactory: (o) => fakePreview(o) });
    pane.start();
    const s = pane.render({ cols: 80, rows: 24, focused: true });
    expect(s).toBe('shell-grid');
  });

  test('onKey → bytes → preview.write', () => {
    let pt: any;
    const pane = createTerminalPaneContent({
      kind: 'terminal', cmd: 'sh',
    }, { terminalFactory: (o) => { pt = fakePreview(o); return pt; } });
    pane.start();
    pane.onKey({ name: 'enter' });
    expect(pt._writes).toContain('\r');
  });

  test('capture returns preview.render(false)', () => {
    const pane = createTerminalPaneContent({ kind: 'terminal' }, {
      terminalFactory: (o) => fakePreview(o),
    });
    pane.start();
    expect(pane.capture()).toBe('shell-grid');
  });

  test('acceptBroadcast submit appends terminal return at pane boundary', () => {
    let pt: any;
    const pane = createTerminalPaneContent({ kind: 'terminal' }, {
      terminalFactory: (o) => { pt = fakePreview(o); return pt; },
    });
    pane.start();
    pane.acceptBroadcast?.({ mode: 'submit', text: 'pwd' });
    expect(pt._writes).toContain('pwd\r');
  });

  test('dispose stops preview', () => {
    let pt: any;
    const pane = createTerminalPaneContent({ kind: 'terminal' }, {
      terminalFactory: (o) => { pt = fakePreview(o); return pt; },
    });
    pane.start();
    pane.dispose();
    expect(pt.isAlive).toBe(false);
  });
});

describe('markdown pane content', () => {
  test('renders markdown output padded to rows', () => {
    const pane = createMarkdownPaneContent({ kind: 'markdown', text: '# hello' }, {});
    const out = pane.render({ cols: 80, rows: 4, focused: false });
    const lines = out.split('\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('hello');
    expect(lines[0]).not.toContain('# hello');
  });

  test('soft-wraps long rendered lines', () => {
    const pane = createMarkdownPaneContent({ kind: 'markdown', text: '`' + 'a'.repeat(25) + '`' }, {});
    const out = pane.render({ cols: 10, rows: 5, focused: false });
    const lines = out.split('\n');
    expect(lines[0]!.length).toBeGreaterThan(0);
    expect(lines[1]!.length).toBeGreaterThan(0);
    expect(lines[2]!.length).toBeGreaterThan(0);
  });

  test('narrow markdown table uses block-aware overflow instead of row re-wrap', () => {
    const pane = createMarkdownPaneContent({
      kind: 'markdown',
      text: [
        '| 순서 | 왕 | 재위 기간 |',
        '|---:|---|---|',
        '| 10 | 연산군 | 1494~1506 |',
        '| 11 | 중종 | 1506~1544 |',
      ].join('\n'),
    }, {});
    const out = pane.render({ cols: 18, rows: 8, focused: false });
    const nonEmpty = out.split('\n').filter((line) => line.trim().length > 0);
    expect(nonEmpty.length).toBeLessThanOrEqual(6);
    expect(nonEmpty.some((line) => line.includes('…'))).toBe(true);
  });

  test('write replaces text + emits update', () => {
    const pane = createMarkdownPaneContent({ kind: 'markdown', text: 'a' }, {});
    let updates = 0;
    pane.on('update', () => updates++);
    pane.write('b');
    expect(pane.capture()).toBe('b');
    expect(updates).toBe(1);
  });

  test('acceptBroadcast replace updates markdown body', () => {
    const pane = createMarkdownPaneContent({ kind: 'markdown', text: 'a' }, {});
    pane.acceptBroadcast?.({ mode: 'replace', text: 'b' });
    expect(pane.capture()).toBe('b');
  });

  test('onKey is a no-op (static)', () => {
    const pane = createMarkdownPaneContent({ kind: 'markdown', text: 'a' }, {});
    expect(pane.onKey({ name: 'a' }).type).toBe('none');
  });
});

describe('scratch pane content', () => {
  test('initialText applied', () => {
    const pane = createScratchPaneContent({ kind: 'scratch', initialText: 'init' }, {});
    expect(pane.capture()).toBe('init');
  });
});

describe('llm-chat pane content', () => {
  test('composing + enter triggers submit', async () => {
    const chunks: string[] = [];
    const pane = createLLMChatPaneContent({ kind: 'llm-chat', provider: 'grok', seed: 'hello' }, {
      llmChatBackend: async function* () {
        yield 'hi ';
        yield 'there';
      },
    });
    for (const ch of ['h', 'e', 'y']) pane.onKey({ name: ch });
    pane.onKey({ name: 'enter' });
    // Let the async submit settle.
    await new Promise(r => setTimeout(r, 5));
    chunks.length = 0;
    const cap = pane.capture();
    expect(cap).toContain('hey');
    expect(cap).toContain('hi there');
  });

  test('stub response when no backend wired', async () => {
    const pane = createLLMChatPaneContent({ kind: 'llm-chat', provider: 'fake' }, {});
    pane.onKey({ name: 'x' });
    pane.onKey({ name: 'enter' });
    await new Promise(r => setTimeout(r, 5));
    expect(pane.capture()).toContain('backend not wired');
  });

  test('backspace pops composing char', () => {
    const pane = createLLMChatPaneContent({ kind: 'llm-chat', provider: 'p' }, {});
    pane.onKey({ name: 'a' });
    pane.onKey({ name: 'b' });
    pane.onKey({ name: 'backspace' });
    // No direct accessor for composing — inspect via render output.
    const out = pane.render({ cols: 20, rows: 8, focused: true });
    // Composing line ends with 'a' + cursor glyph. Just check 'ab'
    // doesn't appear.
    expect(out).not.toContain('ab');
  });

  test('write triggers submit (broadcast path)', async () => {
    const seen: string[] = [];
    const pane = createLLMChatPaneContent({ kind: 'llm-chat', provider: 'g' }, {
      llmChatBackend: async function* (req) {
        seen.push(req.messages[req.messages.length - 1]!.content);
        yield 'ok';
      },
    });
    pane.write('broadcast-msg');
    await new Promise(r => setTimeout(r, 5));
    expect(seen).toContain('broadcast-msg');
  });

  test('acceptBroadcast submit preserves submit semantics without raw CR in payload', async () => {
    const seen: string[] = [];
    const pane = createLLMChatPaneContent({ kind: 'llm-chat', provider: 'g' }, {
      llmChatBackend: async function* (req) {
        seen.push(req.messages[req.messages.length - 1]!.content);
        yield 'ok';
      },
    });
    pane.acceptBroadcast?.({ mode: 'submit', text: 'broadcast-msg' });
    await new Promise(r => setTimeout(r, 5));
    expect(seen).toContain('broadcast-msg');
    expect(seen).not.toContain('broadcast-msg\r');
  });
});

describe('observer (on/emit)', () => {
  test('unsubscribe stops future callbacks', () => {
    const pane: PaneContent = createMarkdownPaneContent({ kind: 'markdown', text: 'a' }, {});
    let n = 0;
    const off = pane.on('update', () => n++);
    pane.write('b');
    expect(n).toBe(1);
    off();
    pane.write('c');
    expect(n).toBe(1);
  });
});
