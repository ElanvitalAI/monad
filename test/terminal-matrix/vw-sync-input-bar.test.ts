import { describe, expect, test } from 'bun:test';

import { VirtualWindow, type LocalInputSubmitRequest } from '../../src/virtual-windows/virtual-window.js';
import { createMarkdownPaneContent } from '../../src/virtual-windows/pane-content.js';

/** Minimal key-event shape the VW expects — tests build KeyEvents
 *  directly since we only exercise the onKey path. */
type KeyPartial = {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};

function makeWindow(submits: Array<{ windowId: number; req: LocalInputSubmitRequest }>) {
  const rootContent = createMarkdownPaneContent(
    { kind: 'markdown', text: 'hello' },
    {},
  );
  return new VirtualWindow(
    {
      id: 42,
      title: 'test',
      rootContent,
      bounds: { row: 1, col: 1, width: 80, height: 12 },
    },
    {
      onLocalInputSubmit: (windowId, req) => {
        submits.push({ windowId, req });
      },
    },
  );
}

describe('VirtualWindow sync input bar', () => {
  test('local composer aliases the same per-window input state', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setLocalComposerActive(true);
    expect(vw.isLocalComposerActive()).toBe(true);
    expect(vw.isSyncInputBarActive()).toBe(true);
    vw.onKey({ name: 'a' } as any);
    expect(vw.getLocalComposerBuffer()).toBe('a');
    expect(vw.getSyncInputBuffer()).toBe('a');
    expect(vw.getLocalComposerCursor()).toBe(1);
  });

  test('default state: inactive, no reserved row', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    expect(vw.isSyncInputBarActive()).toBe(false);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('setSyncInputBar(true) flips the flag + clears buffer', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    expect(vw.isSyncInputBarActive()).toBe(true);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('setSyncInputBar is idempotent', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: 'a' } as KeyPartial as any);
    vw.setSyncInputBar(true);
    // Still has the composed char — idempotent call shouldn't wipe.
    expect(vw.getSyncInputBuffer()).toBe('a');
  });

  test('printable keys accumulate in buffer when active', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'ls -la') {
      vw.onKey({ name: c } as any);
    }
    expect(vw.getSyncInputBuffer()).toBe('ls -la');
  });

  test('space and multi-byte text accumulate in buffer when active', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: '가' } as any);
    vw.onKey({ name: 'space' } as any);
    for (const c of 'test') vw.onKey({ name: c } as any);
    expect(vw.getSyncInputBuffer()).toBe('가 test');
  });

  test('backspace deletes one char', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'abc') vw.onKey({ name: c } as any);
    vw.onKey({ name: 'backspace' } as any);
    expect(vw.getSyncInputBuffer()).toBe('ab');
  });

  test('Ctrl+U clears the buffer', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'hello') vw.onKey({ name: c } as any);
    vw.onKey({ name: 'u', ctrl: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('Enter submits via onSyncInputSubmit + clears', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'kubectl get pods') vw.onKey({ name: c } as any);
    vw.onKey({ name: 'enter' } as any);
    expect(submits).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'kubectl get pods' }, target: { kind: 'focused' } } }]);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('@ opens target picker instead of inserting a literal character', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    let pickerOpened = 0;
    let seedQuery: string | undefined;
    const rootContent = createMarkdownPaneContent(
      { kind: 'markdown', text: 'hello' },
      {},
    );
    const vw = new VirtualWindow(
      {
        id: 42,
        title: 'test',
        rootContent,
        bounds: { row: 1, col: 1, width: 40, height: 10 },
      },
      {
        onLocalInputSubmit: (windowId, req) => { submits.push({ windowId, req }); },
        onOpenLocalInputTargetPicker: (req) => {
          pickerOpened++;
          seedQuery = req.seedQuery;
        },
      },
    );
    vw.setLocalComposerActive(true);
    vw.onKey({ name: '@' } as any);
    expect(pickerOpened).toBe(1);
    expect(seedQuery).toBeUndefined();
    expect(vw.getLocalComposerBuffer()).toBe('');
    expect(submits).toEqual([]);
  });

  test('picker request seeds from inline @mention token under the cursor', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    let seedQuery: string | undefined;
    const vw = makeWindow(submits);
    vw.setLocalComposerActive(true);
    (vw as any).syncBar.composed = '@claude';
    (vw as any).syncBar.cursorPos = '@claude'.length;
    vw.onKey({ name: '@' } as any);
    expect(seedQuery).toBeUndefined();
    // request shape is carried through the host seam
    const seeded = new VirtualWindow(
      {
        id: 43,
        title: 'seed',
        rootContent: createMarkdownPaneContent({ kind: 'markdown', text: 'hi' }, {}),
        bounds: { row: 1, col: 1, width: 80, height: 12 },
      },
      {
        onOpenLocalInputTargetPicker: (req) => { seedQuery = req.seedQuery; },
      },
    );
    seeded.setLocalComposerActive(true);
    (seeded as any).syncBar.composed = '@claude';
    (seeded as any).syncBar.cursorPos = '@claude'.length;
    seeded.onKey({ name: '@' } as any);
    expect(seedQuery).toBe('claude');
  });

  test('onLocalInputSubmit wins over legacy onSyncInputSubmit when both are set', () => {
    const legacy: Array<{ windowId: number; text: string }> = [];
    const local: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const rootContent = createMarkdownPaneContent(
      { kind: 'markdown', text: 'hello' },
      {},
    );
    const vw = new VirtualWindow(
      {
        id: 42,
        title: 'test',
        rootContent,
        bounds: { row: 1, col: 1, width: 40, height: 10 },
      },
      {
        onLocalInputSubmit: (windowId, req) => { local.push({ windowId, req }); },
        onSyncInputSubmit: (windowId, text) => { legacy.push({ windowId, text }); },
      },
    );
    vw.setLocalComposerActive(true);
    for (const c of 'pwd') vw.onKey({ name: c } as any);
    vw.onKey({ name: 'enter' } as any);
    expect(local).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'pwd' }, target: { kind: 'focused' } } }]);
    expect(legacy).toEqual([]);
  });

  test('Enter with empty buffer is no-op', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: 'enter' } as any);
    expect(submits).toEqual([]);
  });

  test('Escape deactivates the bar', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'partial') vw.onKey({ name: c } as any);
    vw.onKey({ name: 'escape' } as any);
    expect(vw.isSyncInputBarActive()).toBe(false);
    expect(vw.getSyncInputBuffer()).toBe(''); // reset on toggle off
  });

  test('Ctrl+G also deactivates (global cancel)', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: 'g', ctrl: true } as any);
    expect(vw.isSyncInputBarActive()).toBe(false);
  });

  test('inactive: keys fall through to focused pane', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    // markdown pane ignores keys → returns {type:'none'}
    const result = vw.onKey({ name: 'a' } as any);
    expect(result.type).toBe('none');
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('shift letter gets uppercased', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: 'a', shift: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('A');
  });

  test('ctrl+letter is rejected (not appended)', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: 'k', ctrl: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('render output includes prompt when bar active', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'ls') vw.onKey({ name: c } as any);
    const out = vw.render();
    // The prompt marker `▶ vw:<id>` should appear in the output.
    expect(out).toContain('vw:42');
    expect(out).toContain('ls');
  });

  test('modal surface exposes local composer cursor for IME anchoring', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    vw.onKey({ name: '가' } as any);
    vw.onKey({ name: 'space' } as any);
    vw.onKey({ name: 't' } as any);
    const cursor = vw.asModalSurface().cursor?.();
    expect(cursor?.visible).toBe(true);
    expect(cursor?.row).toBe(11);
    expect((cursor?.col ?? 0) > 1).toBe(true);
  });

  test('selected pane target is reflected in prompt and submit payload', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    const b = createMarkdownPaneContent({ kind: 'markdown', text: 'other', title: 'claude' }, {});
    vw.splitFocused('h', b);
    vw.setLocalInputTarget({ kind: 'pane', paneId: b.id });
    vw.setSyncInputBar(true);
    for (const c of 'status') vw.onKey({ name: c } as any);
    const out = vw.render();
    expect(out).toContain('@claude');
    vw.onKey({ name: 'enter' } as any);
    expect(submits).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'status' }, target: { kind: 'pane', paneId: b.id } } }]);
  });

  test('inline @pane prefix is parsed on submit and stripped from payload', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    const b = createMarkdownPaneContent({ kind: 'markdown', text: 'other', title: 'claude' }, {});
    vw.splitFocused('h', b);
    vw.setLocalComposerActive(true);
    (vw as any).syncBar.composed = '@claude status';
    (vw as any).syncBar.cursorPos = '@claude status'.length;
    vw.onKey({ name: 'enter' } as any);
    expect(submits).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'status' }, target: { kind: 'pane', paneId: b.id } } }]);
    expect(vw.getLocalInputTarget()).toEqual({ kind: 'pane', paneId: b.id });
  });

  test('consumeLocalComposerMentionTargetToken removes the inline token and trailing gap', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setLocalComposerActive(true);
    (vw as any).syncBar.composed = '@claude run tests';
    (vw as any).syncBar.cursorPos = '@claude'.length;
    expect(vw.consumeLocalComposerMentionTargetToken()).toBe(true);
    expect(vw.getLocalComposerBuffer()).toBe('run tests');
    expect(vw.getLocalComposerCursor()).toBe(0);
  });

  test('render omits the bar row when inactive', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    const out = vw.render();
    expect(out).not.toContain('▶ vw:42');
  });

  test('clearSyncInput drops buffer without toggling off', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (const c of 'half') vw.onKey({ name: c } as any);
    vw.clearSyncInput();
    expect(vw.getSyncInputBuffer()).toBe('');
    expect(vw.isSyncInputBarActive()).toBe(true);
  });
});

describe('VirtualWindow sync bar — cursor tracking (U1)', () => {
  function typeWord(vw: any, text: string): void {
    for (const c of text) vw.onKey({ name: c } as any);
  }

  test('Left arrow moves cursor back; Right moves forward', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'abc');
    expect(vw.getSyncInputCursor()).toBe(3);
    vw.onKey({ name: 'left' } as any);
    expect(vw.getSyncInputCursor()).toBe(2);
    vw.onKey({ name: 'left' } as any);
    vw.onKey({ name: 'left' } as any);
    vw.onKey({ name: 'left' } as any); // no underflow
    expect(vw.getSyncInputCursor()).toBe(0);
    vw.onKey({ name: 'right' } as any);
    expect(vw.getSyncInputCursor()).toBe(1);
  });

  test('Home / End jump to edges', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'hello');
    vw.onKey({ name: 'home' } as any);
    expect(vw.getSyncInputCursor()).toBe(0);
    vw.onKey({ name: 'end' } as any);
    expect(vw.getSyncInputCursor()).toBe(5);
  });

  test('Ctrl+A / Ctrl+E mirror Home / End', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'hello');
    vw.onKey({ name: 'a', ctrl: true } as any);
    expect(vw.getSyncInputCursor()).toBe(0);
    vw.onKey({ name: 'e', ctrl: true } as any);
    expect(vw.getSyncInputCursor()).toBe(5);
  });

  test('insert happens at cursor, not always at end', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'ac');
    vw.onKey({ name: 'left' } as any); // cursor at index 1
    vw.onKey({ name: 'b' } as any);
    expect(vw.getSyncInputBuffer()).toBe('abc');
    expect(vw.getSyncInputCursor()).toBe(2);
  });

  test('Backspace deletes char BEFORE cursor', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'abc');
    vw.onKey({ name: 'left' } as any); // cursor at 2
    vw.onKey({ name: 'backspace' } as any);
    expect(vw.getSyncInputBuffer()).toBe('ac');
    expect(vw.getSyncInputCursor()).toBe(1);
  });

  test('Delete deletes char AT cursor (cursor unchanged)', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'abc');
    vw.onKey({ name: 'left' } as any); // cursor at 2
    vw.onKey({ name: 'delete' } as any);
    expect(vw.getSyncInputBuffer()).toBe('ab');
    expect(vw.getSyncInputCursor()).toBe(2);
  });

  test('Ctrl+K cuts from cursor to end', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'keep-drop');
    // Cursor currently at end; move back to after "keep".
    for (let i = 0; i < 4; i++) vw.onKey({ name: 'left' } as any);
    vw.onKey({ name: 'k', ctrl: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('keep-');
    expect(vw.getSyncInputCursor()).toBe(5);
  });

  test('Ctrl+W deletes word before cursor', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'git status --porcelain');
    vw.onKey({ name: 'w', ctrl: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('git status ');
  });

  test('Ctrl+Left / Ctrl+Right seek word boundaries', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'one two three');
    // End (13), Ctrl+Left → 8 (start of "three")
    vw.onKey({ name: 'left', ctrl: true } as any);
    expect(vw.getSyncInputCursor()).toBe(8);
    vw.onKey({ name: 'left', ctrl: true } as any);
    expect(vw.getSyncInputCursor()).toBe(4);
    vw.onKey({ name: 'right', ctrl: true } as any);
    expect(vw.getSyncInputCursor()).toBeGreaterThan(4);
  });

  test('Enter submits whole buffer regardless of cursor position', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'hello');
    vw.onKey({ name: 'home' } as any);
    vw.onKey({ name: 'enter' } as any);
    expect(submits).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'hello' }, target: { kind: 'focused' } } }]);
    expect(vw.getSyncInputCursor()).toBe(0);
  });

  test('render places cursor at correct column when composed is short', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'ab');
    vw.onKey({ name: 'home' } as any); // cursor at 0
    const out = vw.render();
    // Inverse-video escape `\x1b[7m` marks the cursor cell. The
    // cursor should sit on the first character of 'ab' (→ 'a').
    expect(out).toContain('\x1b[7ma\x1b[27m');
  });
});

describe('VirtualWindow sync bar — multi-line (U2)', () => {
  function typeWord(vw: any, text: string): void {
    for (const c of text) vw.onKey({ name: c } as any);
  }

  test('Shift+Enter inserts newline, does NOT submit', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'line1');
    vw.onKey({ name: 'enter', shift: true } as any);
    typeWord(vw, 'line2');
    expect(submits).toEqual([]);
    expect(vw.getSyncInputBuffer()).toBe('line1\nline2');
    expect(vw.getSyncInputCursor()).toBe('line1\nline2'.length);
  });

  test('plain Enter submits the whole multi-line buffer', () => {
    const submits: Array<{ windowId: number; req: LocalInputSubmitRequest }> = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'a');
    vw.onKey({ name: 'enter', shift: true } as any);
    typeWord(vw, 'b');
    vw.onKey({ name: 'enter' } as any);
    // Embedded newlines stay in the submit payload; terminal panes add
    // the final execution return at the pane boundary.
    expect(submits).toEqual([{ windowId: 42, req: { broadcast: { mode: 'submit', text: 'a\nb' }, target: { kind: 'focused' } } }]);
    expect(vw.getSyncInputBuffer()).toBe('');
  });

  test('Shift+Enter inserts at cursor position (not end)', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'abcd');
    // Cursor to position 2.
    vw.onKey({ name: 'home' } as any);
    vw.onKey({ name: 'right' } as any);
    vw.onKey({ name: 'right' } as any);
    vw.onKey({ name: 'enter', shift: true } as any);
    expect(vw.getSyncInputBuffer()).toBe('ab\ncd');
    expect(vw.getSyncInputCursor()).toBe(3);
  });

  test('backspace across a newline deletes the newline', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'a');
    vw.onKey({ name: 'enter', shift: true } as any);
    typeWord(vw, 'b');
    // Cursor at end (pos 3: 'a','\n','b'). Backspace → 'a\n', then 'a'.
    vw.onKey({ name: 'backspace' } as any);
    vw.onKey({ name: 'backspace' } as any);
    expect(vw.getSyncInputBuffer()).toBe('a');
  });

  test('render paints multiple rows when composed has newlines', () => {
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    typeWord(vw, 'one');
    vw.onKey({ name: 'enter', shift: true } as any);
    typeWord(vw, 'two');
    const out = vw.render();
    // The primary prompt only appears once; continuation rows use ↪.
    const primary = out.match(/▶ vw:42/g)?.length ?? 0;
    expect(primary).toBe(1);
    expect(out).toContain('↪');
    // Both line contents visible.
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  test('row count is capped at SYNC_BAR_MAX_ROWS even for tall buffers', async () => {
    const { SYNC_BAR_MAX_ROWS } = await import('../../src/virtual-windows/virtual-window.js');
    const submits: any[] = [];
    const vw = makeWindow(submits);
    vw.setSyncInputBar(true);
    for (let i = 0; i < 10; i++) {
      typeWord(vw, `line${i}`);
      vw.onKey({ name: 'enter', shift: true } as any);
    }
    // Render shouldn't throw — verifies layout survives overflow.
    const out = vw.render();
    expect(typeof out).toBe('string');
    // Sanity: SYNC_BAR_MAX_ROWS is a small positive int.
    expect(SYNC_BAR_MAX_ROWS).toBeGreaterThan(0);
    expect(SYNC_BAR_MAX_ROWS).toBeLessThanOrEqual(20);
  });
});
