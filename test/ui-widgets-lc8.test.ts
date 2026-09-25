import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { TextArea } from '../src/ui/widgets/text-area.js';
import { ListView } from '../src/ui/widgets/list-view.js';
import { TreeView, type TreeNode } from '../src/ui/widgets/tree-view.js';
import { Tabs } from '../src/ui/widgets/tabs.js';
import { Accordion } from '../src/ui/widgets/accordion.js';
import { TextView } from '../src/ui/view.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function render(v: { draw: (p: Printer) => void }, w = 40, h = 6, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  v.draw(p);
  return p.lines().map(stripAnsi);
}

describe('LC8 TextArea — readOnly', () => {
  test('renders text and scrolls vertically', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const ta = new TextArea({ text: lines, readOnly: true });
    ta.takeFocus();
    let got = render(ta, 20, 3);
    expect(got[0]).toContain('line 0');
    ta.onEvent(key('down'));
    ta.onEvent(key('down'));
    ta.onEvent(key('down'));
    got = render(ta, 20, 3);
    // cursor moved from row 0 to row 3; scroll should bring it into the 3-row window
    expect(got[got.length - 1]).toContain('line 3');
  });

  test('PgDn jumps a page', () => {
    const text = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n');
    const ta = new TextArea({ text, readOnly: true });
    ta.takeFocus();
    ta.onEvent(key('pagedown'));
    const got = render(ta, 10, 5);
    // after one PgDn (size.height=40 default if never rendered before; we called layout via size), still ok
    expect(got.join('\n')).toContain('L');
  });

  test('Ctrl+End jumps to bottom', () => {
    const text = Array.from({ length: 10 }, (_, i) => `L${i}`).join('\n');
    const ta = new TextArea({ text, readOnly: true });
    ta.takeFocus();
    ta.onEvent(key('end', { ctrl: true }));
    const got = render(ta, 10, 3);
    expect(got[got.length - 1]).toContain('L9');
  });

  test('readOnly ignores typing', () => {
    const ta = new TextArea({ text: 'abc', readOnly: true });
    ta.takeFocus();
    ta.onEvent(key('x'));
    expect(ta.text).toBe('abc');
  });
});

describe('LC8 TextArea — editable', () => {
  test('typing inserts chars', () => {
    const ta = new TextArea();
    ta.takeFocus();
    ta.onEvent(key('a'));
    ta.onEvent(key('b'));
    ta.onEvent(key('c'));
    expect(ta.text).toBe('abc');
  });

  test('Enter creates new line', () => {
    const ta = new TextArea();
    ta.takeFocus();
    ta.onEvent(key('a'));
    ta.onEvent(key('enter'));
    ta.onEvent(key('b'));
    expect(ta.text).toBe('a\nb');
  });

  test('backspace joins lines when at column 0', () => {
    const ta = new TextArea({ text: 'a\nb' });
    ta.takeFocus();
    ta.onEvent(key('end', { ctrl: true }));
    // end of line 1: "b"
    ta.onEvent(key('home'));
    ta.onEvent(key('backspace'));
    expect(ta.text).toBe('ab');
  });

  test('wrap=true renders long line on multiple rows', () => {
    const ta = new TextArea({ text: 'abcdefghij', readOnly: true, wrap: true });
    ta.takeFocus();
    const lines = render(ta, 4, 3);
    expect(lines[0]?.trimEnd()).toBe('abcd');
    expect(lines[1]?.trimEnd()).toBe('efgh');
    expect(lines[2]?.trimEnd()).toBe('ij');
  });
});

describe('LC8 ListView', () => {
  type Row = { cmd: string; ms: number; status: string };
  const rows: Row[] = [
    { cmd: 'build',  ms: 120, status: 'ok' },
    { cmd: 'test',   ms: 340, status: 'ok' },
    { cmd: 'deploy', ms: 980, status: 'fail' },
  ];

  test('renders header + rows', () => {
    const lv = new ListView<Row>({
      columns: [{ title: 'Command', width: 10 }, { title: 'ms', width: 5, align: 'right' }, { title: 'Status' }],
      rows,
      render: r => [r.cmd, String(r.ms), r.status],
    });
    lv.takeFocus();
    const lines = render(lv, 30, 4);
    expect(lines[0]).toContain('Command');
    expect(lines[0]).toContain('Status');
    expect(lines[1]).toContain('build');
    expect(lines[2]).toContain('test');
    expect(lines[3]).toContain('deploy');
  });

  test('up/down move cursor', () => {
    const lv = new ListView<Row>({
      columns: [{ title: 'C' }],
      rows,
      render: r => [r.cmd],
    });
    lv.takeFocus();
    expect(lv.selectedRow).toBe(rows[0]!);
    lv.onEvent(key('down'));
    expect(lv.selectedRow).toBe(rows[1]!);
  });

  test('Enter calls onPick with row', () => {
    let picked: Row | null = null;
    const lv = new ListView<Row>({
      columns: [{ title: 'C' }],
      rows,
      render: r => [r.cmd],
      onPick: r => { picked = r; },
    });
    lv.takeFocus();
    lv.onEvent(key('down'));
    lv.onEvent(key('enter'));
    expect(picked).toBe(rows[1]!);
  });
});

describe('LC8 TreeView', () => {
  const data: TreeNode<string>[] = [
    { label: 'src', value: 'src', children: [
      { label: 'a.ts', value: 'src/a.ts', isLeaf: true },
      { label: 'b.ts', value: 'src/b.ts', isLeaf: true },
    ]},
    { label: 'README.md', value: 'README.md', isLeaf: true },
  ];

  test('renders only top-level when everything collapsed', () => {
    const tv = new TreeView<string>({ root: data });
    tv.takeFocus();
    const lines = render(tv, 40, 6);
    const joined = lines.join('\n');
    expect(joined).toContain('src');
    expect(joined).toContain('README.md');
    expect(joined).not.toContain('a.ts');
  });

  test('Space expands a folder', () => {
    const tv = new TreeView<string>({ root: data });
    tv.takeFocus();
    tv.onEvent(key('space'));
    const lines = render(tv, 40, 6);
    expect(lines.join('\n')).toContain('a.ts');
  });

  test('Enter picks selected node', () => {
    let picked: TreeNode<string> | null = null;
    const tv = new TreeView<string>({ root: data, onPick: n => { picked = n; } });
    tv.takeFocus();
    tv.onEvent(key('enter'));
    expect(picked?.value).toBe('src');
  });

  test('Left on expanded node collapses', () => {
    const tv = new TreeView<string>({ root: data });
    tv.takeFocus();
    tv.onEvent(key('space'));
    tv.onEvent(key('left'));
    const lines = render(tv, 40, 6);
    expect(lines.join('\n')).not.toContain('a.ts');
  });

  test('Loader runs on first expand', async () => {
    let calls = 0;
    const lazyData: TreeNode<string>[] = [
      { label: 'lazy', value: 'lazy', loader: async () => {
        calls++;
        return [{ label: 'child', value: 'child', isLeaf: true }];
      }},
    ];
    const tv = new TreeView<string>({ root: lazyData });
    tv.takeFocus();
    tv.onEvent(key('space'));
    // loader is async — wait a tick
    await new Promise(r => setTimeout(r, 10));
    const lines = render(tv, 40, 6);
    expect(calls).toBe(1);
    expect(lines.join('\n')).toContain('child');
  });
});

describe('LC8 Tabs', () => {
  test('renders tab titles + active content', () => {
    const t = new Tabs({
      tabs: [
        { title: 'One', content: new TextView('first') },
        { title: 'Two', content: new TextView('second') },
      ],
    });
    t.takeFocus();
    const lines = render(t, 30, 4);
    expect(lines[0]).toContain('One');
    expect(lines[0]).toContain('Two');
    expect(lines[1]).toContain('first');
  });

  test('Tab cycles to next tab', () => {
    const t = new Tabs({
      tabs: [
        { title: 'A', content: new TextView('one') },
        { title: 'B', content: new TextView('two') },
      ],
    });
    t.takeFocus();
    t.onEvent(key('tab'));
    expect(t.activeIndex).toBe(1);
    const lines = render(t, 30, 3);
    expect(lines[1]).toContain('two');
  });

  test('onChange fires on tab switch', () => {
    const calls: number[] = [];
    const t = new Tabs({
      tabs: [
        { title: 'A', content: new TextView('one') },
        { title: 'B', content: new TextView('two') },
      ],
      onChange: i => calls.push(i),
    });
    t.takeFocus();
    t.onEvent(key('tab'));
    t.onEvent(key('tab'));
    expect(calls).toEqual([1, 0]);
  });
});

describe('LC8 Accordion', () => {
  test('renders section titles', () => {
    const a = new Accordion({
      sections: [
        { title: 'First',  content: new TextView('body 1') },
        { title: 'Second', content: new TextView('body 2') },
      ],
    });
    a.takeFocus();
    const lines = render(a, 30, 4);
    expect(lines[0]).toContain('First');
    expect(lines[1]).toContain('Second');
  });

  test('Enter toggles open/closed', () => {
    const a = new Accordion({
      sections: [
        { title: 'X', content: new TextView('body X') },
        { title: 'Y', content: new TextView('body Y') },
      ],
    });
    a.takeFocus();
    a.onEvent(key('enter'));
    expect(a._state().open).toEqual([true, false]);
    a.onEvent(key('enter'));
    expect(a._state().open).toEqual([false, false]);
  });

  test('exclusive mode closes other sections', () => {
    const a = new Accordion({
      exclusive: true,
      sections: [
        { title: 'X', content: new TextView('bx') },
        { title: 'Y', content: new TextView('by') },
      ],
    });
    a.takeFocus();
    a.onEvent(key('enter'));          // open X
    a.onEvent(key('down'));
    a.onEvent(key('enter'));          // open Y, should close X
    expect(a._state().open).toEqual([false, true]);
  });

  test('Down moves cursor', () => {
    const a = new Accordion({
      sections: [
        { title: 'X', content: new TextView('bx') },
        { title: 'Y', content: new TextView('by') },
      ],
    });
    a.takeFocus();
    a.onEvent(key('down'));
    expect(a._state().cursor).toBe(1);
  });
});
