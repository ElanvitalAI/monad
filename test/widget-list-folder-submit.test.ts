// Arc C · v2 — list widget submitText override for folder rows.
//
// The dashboard populates `state.submitText[idx]` with a
// `folder-attach:<abs-path>` tag on folder rows so double-click
// routes to the folder picker modal (via dispatchSidebarSubmit)
// instead of echoing the filename label as plain text. Files and
// non-overridden rows keep the pre-Arc-C submit path (items[idx]).

import { describe, expect, test } from 'bun:test';
import listWidget, { type ListWidgetState } from '../widgets/list/widget.js';
import type { WidgetMouseEvent, WidgetContext } from '../src/widgets/types.js';

// Minimal ctx stub — the list widget's onMouse ignores the context
// on mouse paths (only render uses ctx). Typed as `never` per
// widget-types.ts for actions the test doesn't need to trigger.
const CTX = {} as WidgetContext;

function state(overrides: Partial<ListWidgetState> = {}): ListWidgetState {
  return {
    items: ['src', 'README.md', 'node_modules'],
    icons: [],
    cursor: 0,
    offset: 0,
    selected: new Set(),
    focused: true,
    preserveAnsi: false,
    ...overrides,
  };
}

function dbl(row: number, col: number): WidgetMouseEvent {
  return { type: 'double-click', row, col };
}

describe('list widget onMouse · folder-attach submitText (Arc C v2)', () => {
  test('double-click on a row without submitText override submits the item label', () => {
    const s = state();
    const action = listWidget.onMouse!(dbl(2, 3), s, CTX);
    expect(action.type).toBe('submit');
    // Row 1 of body == items[1] (title takes row 0).
    expect((action as { type: 'submit'; text: string }).text).toBe('README.md');
  });

  test('double-click on a folder row routes to folder-attach:<abs-path>', () => {
    const s = state({
      submitText: [
        'folder-attach:/abs/src',
        undefined,
        'folder-attach:/abs/node_modules',
      ],
    });
    // Click body row 0 (items[0] = 'src')
    const action = listWidget.onMouse!(dbl(1, 3), s, CTX);
    expect(action.type).toBe('submit');
    expect((action as { type: 'submit'; text: string }).text).toBe('folder-attach:/abs/src');
  });

  test('double-click on a file row (undefined submitText slot) falls back to items[idx]', () => {
    const s = state({
      submitText: [
        'folder-attach:/abs/src',
        undefined,                              // README.md — no override
        'folder-attach:/abs/node_modules',
      ],
    });
    const action = listWidget.onMouse!(dbl(2, 3), s, CTX);
    expect(action.type).toBe('submit');
    expect((action as { type: 'submit'; text: string }).text).toBe('README.md');
  });

  test('double-click on a folder row with empty-string submitText slot falls back to items[idx]', () => {
    // Guard against a host accidentally zeroing a slot instead of
    // removing it. Empty string is treated as "no override" so the
    // submit still produces a meaningful value.
    const s = state({
      submitText: ['', undefined, undefined],
    });
    const action = listWidget.onMouse!(dbl(1, 3), s, CTX);
    expect(action.type).toBe('submit');
    expect((action as { type: 'submit'; text: string }).text).toBe('src');
  });

  test('single click on a folder row updates cursor but does NOT submit', () => {
    const s = state({
      submitText: [
        'folder-attach:/abs/src',
        undefined,
        'folder-attach:/abs/node_modules',
      ],
    });
    const action = listWidget.onMouse!({ type: 'click', row: 1, col: 3 }, s, CTX);
    expect(action.type).toBe('refresh');
    expect(s.cursor).toBe(0);
  });

  test('scroll events never fire submit regardless of submitText overrides', () => {
    const s = state({
      submitText: [
        'folder-attach:/abs/src',
        undefined,
        'folder-attach:/abs/node_modules',
      ],
    });
    const up = listWidget.onMouse!({ type: 'scroll-up', row: 1, col: 3 }, s, CTX);
    const down = listWidget.onMouse!({ type: 'scroll-down', row: 1, col: 3 }, s, CTX);
    expect(up.type).toBe('refresh');
    expect(down.type).toBe('refresh');
  });

  test('double-click on a file row with file-attach override submits the attach prefix', () => {
    // Symmetric with folder-attach — files get direct attach semantics
    // without a modal step, so the submit text is the file-attach:<abs>
    // prefix that dispatchSidebarSubmit routes through
    // attachFilePathToken + promptCtl.insertAtCursor.
    const s = state({
      submitText: [
        'folder-attach:/abs/src',
        'file-attach:/abs/README.md',
        'folder-attach:/abs/node_modules',
      ],
    });
    const action = listWidget.onMouse!(dbl(2, 3), s, CTX);
    expect(action.type).toBe('submit');
    expect((action as { type: 'submit'; text: string }).text).toBe('file-attach:/abs/README.md');
  });

  test('mixed submitText rows dispatch to their respective prefixes per row', () => {
    const base = state({
      items: ['src', 'README.md', 'node_modules'],
      submitText: [
        'folder-attach:/abs/src',
        'file-attach:/abs/README.md',
        'folder-attach:/abs/node_modules',
      ],
    });
    const folder = listWidget.onMouse!(dbl(1, 3), base, CTX);
    const file = listWidget.onMouse!(dbl(2, 3), base, CTX);
    const nested = listWidget.onMouse!(dbl(3, 3), base, CTX);
    expect((folder as { text: string }).text).toBe('folder-attach:/abs/src');
    expect((file as { text: string }).text).toBe('file-attach:/abs/README.md');
    expect((nested as { text: string }).text).toBe('folder-attach:/abs/node_modules');
  });

  test('double-click on the `..` parent row submits a wd-cd prefix', () => {
    // `..` isn't an attach target — it's navigation. dispatchSidebar
    // Submit routes the wd-cd:<abs> prefix to enterDirectory so
    // dblclick mirrors the keyboard Enter-on-`..` behavior.
    const s = state({
      items: ['..', 'src', 'README.md'],
      submitText: [
        'wd-cd:/Users/foo',
        'folder-attach:/Users/foo/project/src',
        'file-attach:/Users/foo/project/README.md',
      ],
    });
    const action = listWidget.onMouse!(dbl(1, 3), s, CTX);
    expect(action.type).toBe('submit');
    expect((action as { type: 'submit'; text: string }).text).toBe('wd-cd:/Users/foo');
  });
});
