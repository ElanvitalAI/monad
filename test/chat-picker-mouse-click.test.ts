// F-E — picker row click dispatch.
//
// Covers the pre-existing bug where clicks on picker rows were
// silently dropped (picker ModalSurface had no onMouse). After F-E:
//   1. createSlash/Arg/AtPickerModal accept optional `onRowClick`.
//   2. When provided, the returned surface has onMouse wired.
//   3. onMouse computes filtIdx from click row via upward-growing
//      geometry (bounds.row - inputZoneHeight - visibleCount offset).
//   4. PickerState.submitAt(idx, buf) sets cursor + fires Enter.

import { describe, expect, test } from 'bun:test';
import { createPickerState, type PickerBufferView } from '../src/chat/pickers/state.js';
import {
  createChatPickerTestFamily,
  createChatPickerTestSources,
} from './helpers/chat-picker-family-fixture.js';
import type { SlashCommand, ArgSuggestion, AtCandidate } from '../src/chat/index.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

const cmds: SlashCommand[] = [
  { name: 'help',  aliases: ['?'],         description: 'Show help' },
  { name: 'quit',  aliases: ['q', 'exit'], description: 'Exit' },
  { name: 'clear', aliases: ['cls'],       description: 'Clear log' },
];

function slashModal(spec?: {
  getItems?: () => SlashCommand[];
  onRowClick?: (idx: number) => void;
  bounds?: { row: number; col: number; width: number; height: number };
  width?: number;
}) {
  const width = spec?.width ?? 80;
  return createChatPickerTestFamily({
    bounds: spec?.bounds ?? { row: 30, col: 1, width, height: 1 },
    sources: createChatPickerTestSources({
      slashItems: spec?.getItems ?? (() => cmds),
      argItems: () => [],
      atItems: () => [],
    }),
    width,
    bindingOverrides: {
      slash: {
        ...(spec?.onRowClick ? { onRowClick: spec.onRowClick } : {}),
      },
    },
  }).createSurface('slash');
}

function argModal(spec?: {
  getItems?: () => ArgSuggestion[];
  onRowClick?: (idx: number) => void;
}) {
  return createChatPickerTestFamily({
    sources: createChatPickerTestSources({
      slashItems: () => [],
      argItems: spec?.getItems ?? (() => args),
      atItems: () => [],
    }),
    bindingOverrides: {
      arg: {
        ...(spec?.onRowClick ? { onRowClick: spec.onRowClick } : {}),
      },
    },
  }).createSurface('arg');
}

function atModal(spec?: {
  getItems?: () => AtCandidate[];
  onRowClick?: (idx: number) => void;
}) {
  return createChatPickerTestFamily({
    sources: createChatPickerTestSources({
      slashItems: () => [],
      argItems: () => [],
      atItems: spec?.getItems ?? (() => atItems),
    }),
    bindingOverrides: {
      at: {
        ...(spec?.onRowClick ? { onRowClick: spec.onRowClick } : {}),
      },
    },
  }).createSurface('at');
}

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

function listRow(surface: { bounds: { row: number } }, idx: number): number {
  return surface.bounds.row + 1 + idx;
}

describe('chat picker family modal · slash mouse wiring', () => {
  test('onMouse absent when onRowClick is not provided (backwards compat)', () => {
    const m = slashModal();
    expect(m.onMouse).toBeUndefined();
  });

  test('onMouse present when onRowClick is provided', () => {
    const m = slashModal({ onRowClick: () => {} });
    expect(typeof m.onMouse).toBe('function');
  });

  test('click on top row fires onRowClick with filtIdx=0', () => {
    const calls: number[] = [];
    const m = slashModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('click', listRow(m, 0), 10));
    expect(calls).toEqual([0]);
  });

  test('click on middle / bottom row fires with correct filtIdx', () => {
    const calls: number[] = [];
    const m = slashModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('click', listRow(m, 1), 10));
    m.onMouse!(mouse('click', listRow(m, 2), 10));
    expect(calls).toEqual([1, 2]);
  });

  test('double-click also fires onRowClick', () => {
    const calls: number[] = [];
    const m = slashModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('double-click', listRow(m, 1), 10));
    expect(calls).toEqual([1]);
  });

  test('click above or below the row band is ignored', () => {
    const calls: number[] = [];
    const m = slashModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('click', m.bounds.row, 10));   // title row
    m.onMouse!(mouse('click', m.bounds.row + m.bounds.height - 1, 10)); // footer row
    m.onMouse!(mouse('click', 35, 10));   // far below
    expect(calls).toEqual([]);
  });

  test('row click uses the full modal width as the hit target', () => {
    const calls: number[] = [];
    const m = slashModal({
      bounds: { row: 30, col: 10, width: 20, height: 1 },
      width: 20,
      onRowClick: (idx) => { calls.push(idx); },
    });
    const row = listRow(m, 1);
    m.onMouse!(mouse('click', row, 5));
    m.onMouse!(mouse('click', row, 30));
    m.onMouse!(mouse('click', row, 15));
    expect(calls).toEqual([1, 1, 1]);
  });

  test('non-click mouse events are ignored', () => {
    const calls: number[] = [];
    const m = slashModal({ onRowClick: (idx) => { calls.push(idx); } });
    const row = listRow(m, 1);
    m.onMouse!(mouse('right-click', row, 10));
    m.onMouse!(mouse('scroll-up', row, 10));
    m.onMouse!(mouse('scroll-down', row, 10));
    m.onMouse!(mouse('drag', row, 10));
    m.onMouse!(mouse('release', row, 10));
    m.onMouse!(mouse('motion', row, 10));
    expect(calls).toEqual([]);
  });

  test('empty filtered list → click ignored', () => {
    const calls: number[] = [];
    const m = slashModal({
      getItems: () => [],
      onRowClick: (idx) => { calls.push(idx); },
    });
    m.onMouse!(mouse('click', 27, 10));
    expect(calls).toEqual([]);
  });

  test('onMouse returns Action{type:"none"} regardless of hit/miss', () => {
    const m = slashModal({ onRowClick: () => {} });
    expect(m.onMouse!(mouse('click', listRow(m, 1), 10))).toEqual({ type: 'none' });
    expect(m.onMouse!(mouse('click', 0, 0))).toEqual({ type: 'none' });
  });
});

// ── Arg picker ──────────────────────────────────────────────────
const args: ArgSuggestion[] = [
  { value: 'foo.md', description: 'file A' },
  { value: 'bar.md', description: 'file B' },
];

describe('chat picker family modal · arg mouse wiring', () => {
  test('click on row fires onRowClick with correct filtIdx', () => {
    const calls: number[] = [];
    const m = argModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('click', listRow(m, 0), 10));
    m.onMouse!(mouse('click', listRow(m, 1), 10));
    expect(calls).toEqual([0, 1]);
  });
});

// ── @ picker ────────────────────────────────────────────────────
const atItems: AtCandidate[] = [
  { label: '.elanous/',      absPath: '/x/.elanous',      isDir: true },
  { label: 'src/',         absPath: '/x/src',         isDir: true },
  { label: 'README.md',    absPath: '/x/README.md',   isDir: false },
];

describe('chat picker family modal · at mouse wiring', () => {
  test('click on row fires onRowClick with correct filtIdx', () => {
    const calls: number[] = [];
    const m = atModal({ onRowClick: (idx) => { calls.push(idx); } });
    m.onMouse!(mouse('click', listRow(m, 0), 10));
    m.onMouse!(mouse('click', listRow(m, 2), 10));
    expect(calls).toEqual([0, 2]);
  });
});

// ── PickerState.submitAt ────────────────────────────────────────
// ── F-E2 clear wrapper + bounds expansion ────────────────────────
describe('F-E2 · bounds expansion + paint clear wrapper', () => {
  test('slash picker bounds cover list region (not just prompt row)', () => {
    const m = slashModal({ onRowClick: () => {} });
    expect(m.bounds.row).toBe(24);
    expect(m.bounds.height).toBe(6);
    // Row click at 27 (inside list band) now lands inside bounds so
    // dashboard-mouse-wiring's `inside` check forwards to onMouse.
    const inside = (r: number) =>
      r >= m.bounds.row && r < m.bounds.row + m.bounds.height;
    expect(inside(listRow(m, 2))).toBe(true);   // list row
    expect(inside(30)).toBe(false);  // prompt row (not covered)
    expect(inside(23)).toBe(false);  // above picker
  });

  test('paint prepends \\x1b[2K clears across bounds before inner paint', () => {
    const m = slashModal();
    const out = m.paint();
    // Expect at least one clear across the bounds rows. Clear pattern:
    // `\x1b[{row};{col}H\x1b[2K`. Count clear occurrences.
    const clears = out.match(/\x1b\[\d+;\d+H\x1b\[2K/g) ?? [];
    // Bounds height = 6 → 6 clear ANSI prepend (title + list + footer).
    // Inner paint ALSO emits its own moveTo+clear for each list row,
    // so total may be higher. Floor guarantees the wrapper prepended.
    expect(clears.length).toBeGreaterThanOrEqual(6);
  });

  test('paint is empty when inner paint is empty (picker dispose path)', () => {
    const m = slashModal({ getItems: () => [] });
    // When filter returns no items the wrapper SHOULD NOT emit
    // spurious clears — update*PickerModal disposes the handle on
    // this tick, emitting clears would leave visible artifacts.
    expect(m.paint()).toBe('');
  });
});

describe('PickerState.submitAt', () => {
  function mkBuf(line0: string): PickerBufferView {
    return { lines: [line0], lineIdx: 0, colIdx: line0.length };
  }

  test('submitAt(idx) sets cursor + fires submit for slash mode', async () => {
    const state = createPickerState({ commands: cmds });
    await state.refresh(mkBuf('/'));
    // Before: cursor at 0 (help). submitAt(2) should submit 'clear'.
    const result = await state.submitAt(2, mkBuf('/'));
    expect(result.consumed).toBe(true);
    expect(result.action?.kind).toBe('submit');
    if (result.action?.kind === 'submit') {
      expect(result.action.text).toBe('/clear');
    }
    expect(state._snapshot().cmdPickerIdx).toBe(2);
    expect(state._snapshot().pickerNavigated).toBe(true);
  });

  test('submitAt(idx) for already-selected index still fires submit', async () => {
    const state = createPickerState({ commands: cmds });
    await state.refresh(mkBuf('/'));
    const result = await state.submitAt(0, mkBuf('/'));
    expect(result.consumed).toBe(true);
    expect(result.action?.kind).toBe('submit');
    if (result.action?.kind === 'submit') {
      expect(result.action.text).toBe('/help');
    }
  });
});
