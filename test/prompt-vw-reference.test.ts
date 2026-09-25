import { describe, expect, test } from 'bun:test';

import {
  expandVirtualWindowReferences,
  type VWExpandDeps,
} from '../src/prompt/vw-reference.js';
import {
  createAddressBook,
  type PaneRef,
  type WindowRef,
} from '../src/virtual-windows/addressing.js';

interface PaneFixture {
  id: string;
  windowId: number;
  kind: string;
  body: string;
}

function mk(fixtures: { windows: Array<{ id: number; title: string }>; panes: PaneFixture[] }): VWExpandDeps {
  const book = createAddressBook();
  for (const w of fixtures.windows) {
    book.registerWindow({ id: w.id, title: w.title } as WindowRef);
    // AddressBook nextWindowId is driven by register; start above max.
  }
  for (const p of fixtures.panes) {
    book.registerPane({ id: p.id, windowId: p.windowId, kind: p.kind } as PaneRef);
  }
  const paneBody = new Map(fixtures.panes.map(p => [p.id, p.body]));
  return {
    addressBook: book,
    paneLookup: (paneId) => {
      const body = paneBody.get(paneId);
      if (body === undefined) return null;
      return { capture: () => body, kind: fixtures.panes.find(p => p.id === paneId)?.kind };
    },
    listPanes: (winId) => fixtures.panes
      .filter(p => p.windowId === winId)
      .map(p => ({ id: p.id, kind: p.kind })),
  };
}

describe('expandVirtualWindowReferences', () => {
  test('pass through when no @ in input', () => {
    const d = mk({ windows: [], panes: [] });
    expect(expandVirtualWindowReferences('hello world', d)).toBe('hello world');
  });

  test('expands @pane:<id> with full body when small', () => {
    const d = mk({
      windows: [{ id: 1, title: 'w' }],
      panes: [{ id: 'abc', windowId: 1, kind: 'terminal', body: 'LINE1\nLINE2' }],
    });
    const r = expandVirtualWindowReferences('check @pane:abc', d);
    expect(r).toContain('<pane addr="pane:abc" kind="terminal" window="win:1">');
    expect(r).toContain('LINE1');
    expect(r).toContain('LINE2');
    expect(r).toContain('full-11');   // 'LINE1\nLINE2' = 11 chars
  });

  test('honors #<N> byte suffix', () => {
    const d = mk({
      windows: [{ id: 1, title: 'w' }],
      panes: [{ id: 'abc', windowId: 1, kind: 'scratch', body: 'abcdefghijklmnop' }],
    });
    const r = expandVirtualWindowReferences('@pane:abc#4', d);
    expect(r).toContain('<last-4>');
    expect(r).toContain('mnop');
    expect(r).not.toContain('abcdef');
  });

  test('honors #all suffix', () => {
    const d = mk({
      windows: [{ id: 1, title: 'w' }],
      panes: [{ id: 'abc', windowId: 1, kind: 'llm-chat', body: 'full-text' }],
    });
    const r = expandVirtualWindowReferences('@pane:abc#all', d);
    expect(r).toContain('<full>');
    expect(r).toContain('full-text');
  });

  test('qualified @win:N/pane:id resolves identically', () => {
    const d = mk({
      windows: [{ id: 2, title: 'w' }],
      panes: [{ id: 'xyz', windowId: 2, kind: 'terminal', body: 'QPANE' }],
    });
    const r = expandVirtualWindowReferences('@win:2/pane:xyz', d);
    expect(r).toContain('pane:xyz');
    expect(r).toContain('window="win:2"');
    expect(r).toContain('QPANE');
  });

  test('@win:<N> → window summary with pane list', () => {
    const d = mk({
      windows: [{ id: 3, title: 'proj' }],
      panes: [
        { id: 'p1', windowId: 3, kind: 'terminal', body: 'a' },
        { id: 'p2', windowId: 3, kind: 'markdown', body: 'b' },
      ],
    });
    const r = expandVirtualWindowReferences('see @win:3', d);
    expect(r).toContain('<window addr="win:3" title="proj" panes="2">');
    expect(r).toContain('addr="pane:p1" kind="terminal"');
    expect(r).toContain('addr="pane:p2" kind="markdown"');
  });

  test('@win:<N>#all → capture every pane', () => {
    const d = mk({
      windows: [{ id: 3, title: 'proj' }],
      panes: [
        { id: 'p1', windowId: 3, kind: 'terminal', body: 'BODY1' },
        { id: 'p2', windowId: 3, kind: 'markdown', body: 'BODY2' },
      ],
    });
    const r = expandVirtualWindowReferences('@win:3#all', d);
    expect(r).toContain('BODY1');
    expect(r).toContain('BODY2');
    expect(r).toMatch(/<pane addr="pane:p1"[\s\S]*BODY1[\s\S]*<\/pane>/);
    expect(r).toMatch(/<pane addr="pane:p2"[\s\S]*BODY2[\s\S]*<\/pane>/);
  });

  test('unknown @pane id passes through', () => {
    const d = mk({ windows: [], panes: [] });
    const r = expandVirtualWindowReferences('try @pane:ghost please', d);
    expect(r).toContain('@pane:ghost');
  });

  test('unknown @win id passes through', () => {
    const d = mk({ windows: [], panes: [] });
    const r = expandVirtualWindowReferences('@win:99 ok', d);
    expect(r).toContain('@win:99');
  });

  test('escapes HTML-special chars in titles', () => {
    const d = mk({
      windows: [{ id: 1, title: 'a"<b>' }],
      panes: [{ id: 'p', windowId: 1, kind: 'terminal', body: '' }],
    });
    const r = expandVirtualWindowReferences('@win:1', d);
    expect(r).toContain('&quot;');
    expect(r).toContain('&lt;b&gt;');
  });

  test('multiple tokens in the same input', () => {
    const d = mk({
      windows: [{ id: 1, title: 'w' }],
      panes: [
        { id: 'a', windowId: 1, kind: 'terminal', body: 'A' },
        { id: 'b', windowId: 1, kind: 'terminal', body: 'B' },
      ],
    });
    const r = expandVirtualWindowReferences('left @pane:a right @pane:b done', d);
    expect(r).toMatch(/left <pane[\s\S]*A[\s\S]*<\/pane> right <pane[\s\S]*B[\s\S]*<\/pane> done/);
  });
});
