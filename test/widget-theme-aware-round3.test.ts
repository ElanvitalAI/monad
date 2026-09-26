// IDX-6 Widget round-2 (file name "round3" to avoid collision with the
// pre-existing round-1 FU I test file that was confusingly named
// `widget-theme-aware-round2.test.ts`).
//
// Scope: Accordion / Tabs / TreeView / TextArea / Tooltip each gained
// an optional `theme?` spec field. These tests assert:
//   1. backward compat — no theme → pre-Phase rendering holds
//   2. theme-aware — output differs across presets (MOCHA / LATTE /
//      ROSE_PINE_DAWN / ELANOUS_PASTEL_DEFAULT)
//   3. baseline glyphs (cursor, muted prefix) still present in both
//      paths, so callers don't lose visual affordance

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  ELANOUS_PASTEL_DEFAULT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { Printer } from '../src/ui/printer.js';
import { Accordion } from '../src/ui/widgets/accordion.js';
import { Tabs } from '../src/ui/widgets/tabs.js';
import { TreeView } from '../src/ui/widgets/tree-view.js';
import { TextArea } from '../src/ui/widgets/text-area.js';
import { Tooltip } from '../src/ui/widgets/tooltip.js';
import type { View } from '../src/ui/view.js';

const ORIG_CHALK_LEVEL = chalk.level;

function stubView(): View {
  return {
    draw: () => {},
    onEvent: () => ({ kind: 'ignored' }) as const,
    layout: () => {},
    requiredSize: () => ({ width: 0, height: 0 }),
    takeFocus: () => true,
  };
}

function renderToString(
  view: { draw(p: Printer): void; layout?(s: { width: number; height: number }): void; takeFocus?(): boolean },
  width = 40,
  height = 8,
  focused = true,
): string {
  const p = Printer.create({ width, height, focused });
  view.layout?.({ width, height });
  view.takeFocus?.();
  view.draw(p);
  return p.lines().join('\n');
}

beforeEach(() => { chalk.level = 3; });
afterEach(() => { chalk.level = ORIG_CHALK_LEVEL; });

describe('Accordion — theme passthrough', () => {
  const makeSections = () => [
    { title: 'Section A', content: stubView() },
    { title: 'Section B', content: stubView() },
  ];

  test('without theme renders titles (backward compat)', () => {
    const acc = new Accordion({ sections: makeSections() });
    const out = renderToString(acc);
    expect(out).toContain('Section A');
    expect(out).toContain('Section B');
    // Cursor glyph visible
    expect(out).toContain('❯');
  });

  test('different themes produce different ANSI', () => {
    const outMocha = renderToString(new Accordion({ sections: makeSections(), theme: CATPPUCCIN_MOCHA }));
    const outLatte = renderToString(new Accordion({ sections: makeSections(), theme: CATPPUCCIN_LATTE }));
    expect(outMocha).toContain('Section A');
    expect(outLatte).toContain('Section A');
    expect(outMocha).not.toBe(outLatte);
  });
});

describe('Tabs — theme passthrough', () => {
  const makeTabs = () => [
    { title: 'Main',    content: stubView() },
    { title: 'Details', content: stubView() },
  ];

  test('empty list renders themed empty hint', () => {
    const untheme = renderToString(new Tabs({ tabs: [] }));
    const themed = renderToString(new Tabs({ tabs: [], theme: CATPPUCCIN_MOCHA }));
    expect(untheme).toContain('(no tabs)');
    expect(themed).toContain('(no tabs)');
    expect(themed).not.toBe(untheme);
  });

  test('different themes produce different ANSI for active tab', () => {
    const outMocha = renderToString(new Tabs({ tabs: makeTabs(), theme: CATPPUCCIN_MOCHA }));
    const outLatte = renderToString(new Tabs({ tabs: makeTabs(), theme: CATPPUCCIN_LATTE }));
    expect(outMocha).toContain('Main');
    expect(outLatte).toContain('Main');
    expect(outMocha).not.toBe(outLatte);
  });

  test('active tab gets themed ANSI (cursor color applied)', () => {
    const tabs = new Tabs({ tabs: makeTabs(), theme: ELANOUS_PASTEL_DEFAULT });
    const out = renderToString(tabs);
    // Active label appears surrounded by SGR sequences (\x1b[)
    const sgrCount = (out.match(/\x1b\[/g) ?? []).length;
    expect(sgrCount).toBeGreaterThan(0);
  });
});

describe('TreeView — theme passthrough', () => {
  const root = [
    { label: 'root', value: 'r', children: [{ label: 'child', value: 'c' }] },
  ];

  test('without theme renders label (backward compat)', () => {
    const tv = new TreeView({ root });
    const out = renderToString(tv);
    expect(out).toContain('root');
  });

  test('different themes produce different ANSI for the cursor row', () => {
    const outMocha = renderToString(new TreeView({ root, theme: CATPPUCCIN_MOCHA }));
    const outDawn  = renderToString(new TreeView({ root, theme: ROSE_PINE_DAWN }));
    expect(outMocha).toContain('root');
    expect(outDawn).toContain('root');
    expect(outMocha).not.toBe(outDawn);
  });

  test('empty tree uses themed muted text', () => {
    const outLegacy = renderToString(new TreeView({ root: [] }));
    const outThemed = renderToString(new TreeView({ root: [], theme: ELANOUS_PASTEL_DEFAULT }));
    expect(outLegacy).toContain('(empty)');
    expect(outThemed).toContain('(empty)');
    expect(outLegacy).not.toBe(outThemed);
  });
});

describe('TextArea — theme passthrough', () => {
  test('without theme renders text (backward compat)', () => {
    // readOnly suppresses the cursor bar so the raw text stays
    // contiguous — the backward-compat assertion is about text
    // surfacing at all, not cursor color.
    const ta = new TextArea({ text: 'hello', readOnly: true });
    const out = renderToString(ta, 20, 3);
    expect(out).toContain('hello');
  });

  test('cursor bar differs across themes (editable focused)', () => {
    const a = new TextArea({ text: '', theme: CATPPUCCIN_MOCHA });
    const b = new TextArea({ text: '', theme: CATPPUCCIN_LATTE });
    const outA = renderToString(a, 10, 2, true);
    const outB = renderToString(b, 10, 2, true);
    expect(outA).toContain('▎');
    expect(outB).toContain('▎');
    expect(outA).not.toBe(outB);
  });

  test('readOnly mode does not paint cursor regardless of theme', () => {
    const a = new TextArea({ text: 'hello', theme: CATPPUCCIN_MOCHA, readOnly: true });
    const out = renderToString(a, 20, 2, true);
    expect(out).not.toContain('▎');
    expect(out).toContain('hello');
  });
});

describe('Tooltip — theme passthrough', () => {
  test('without theme renders `▕ ` prefix (backward compat)', () => {
    const tt = new Tooltip({ text: 'hint' });
    const out = renderToString(tt, 20, 1);
    expect(out).toContain('▕ ');
    expect(out).toContain('hint');
  });

  test('different themes produce different ANSI for the muted prefix', () => {
    const outMocha = renderToString(new Tooltip({ text: 'hint', theme: CATPPUCCIN_MOCHA }), 20, 1);
    const outLatte = renderToString(new Tooltip({ text: 'hint', theme: CATPPUCCIN_LATTE }), 20, 1);
    expect(outMocha).toContain('hint');
    expect(outLatte).toContain('hint');
    expect(outMocha).not.toBe(outLatte);
  });

  test('theme also styles tooltip body text, not only the prefix', () => {
    const out = renderToString(new Tooltip({ text: 'hint', theme: ROSE_PINE_DAWN }), 20, 1);
    const textHex = ROSE_PINE_DAWN.colors.text.replace('#', '');
    const r = parseInt(textHex.slice(0, 2), 16);
    const g = parseInt(textHex.slice(2, 4), 16);
    const b = parseInt(textHex.slice(4, 6), 16);
    expect(out).toContain(`${r};${g};${b}`);
  });

  test('theme passthrough via hover-presenter reaches the widget', () => {
    // Integration-flavoured: we're not mounting the presenter here
    // (that's covered by hover-wiring.test.ts), but we assert that
    // the Tooltip spec accepts `theme` and the instance constructs
    // cleanly — if this compiled and renders, the shape is preserved.
    const tt = new Tooltip({ text: 'bounded\nmultiline', theme: ROSE_PINE_DAWN });
    const out = renderToString(tt, 30, 2);
    expect(out).toContain('bounded');
    expect(out).toContain('multiline');
  });
});
