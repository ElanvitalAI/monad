// FU I (IDX-6 Phase 4) — theme-aware refactor: SelectView + ListView
// + ProgressBar.
//
// Mirrors the widget-theme-aware.test.ts harness from Button/Dialog.
// Covers backward-compat (no theme), theme-aware rendering,
// cross-theme differentiation, and progress-bar semantic status
// mapping.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../src/theme/tokens.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  ELANOUS_PASTEL_DEFAULT,
  NORD_LIGHT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { Printer } from '../src/ui/printer.js';
import { ListView } from '../src/ui/widgets/list-view.js';
import { ProgressBar } from '../src/ui/widgets/progress-bar.js';
import { SelectView } from '../src/ui/widgets/select-view.js';

const ORIG_CHALK_LEVEL = chalk.level;

function renderToString(
  view: { draw(p: Printer): void },
  width = 40,
  height = 8,
  focused = true,
): string {
  const p = Printer.create({ width, height, focused });
  view.draw(p);
  return p.lines().join('\n');
}

function hexTriple(hex: string): string {
  const body = hex.replace('#', '');
  return `${parseInt(body.slice(0, 2), 16)};${parseInt(
    body.slice(2, 4),
    16,
  )};${parseInt(body.slice(4, 6), 16)}`;
}

// ─── ProgressBar ──────────────────────────────────────────────────

describe('FU I ProgressBar — backward compat (no theme)', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('renders filled + empty portions + percent text', () => {
    const bar = new ProgressBar({ total: 100, current: 40 });
    const out = renderToString(bar, 20, 1);
    expect(out).toContain('█');
    expect(out).toContain('·');
    expect(out).toContain('40%');
  });

  test('label renders on first row when present (2-row layout)', () => {
    const bar = new ProgressBar({ total: 100, current: 50, label: 'Progress' });
    const out = renderToString(bar, 20, 2);
    expect(out).toContain('Progress');
    expect(out).toContain('50%');
  });

  test('status=error legacy path yields distinct output from default', () => {
    const err = renderToString(
      new ProgressBar({ total: 100, current: 30, status: 'error' }),
      20,
      1,
    );
    const ok = renderToString(
      new ProgressBar({ total: 100, current: 30 }),
      20,
      1,
    );
    expect(err).not.toBe(ok);
    expect(err).toContain('█');
  });

  test('status=review legacy yields distinct output', () => {
    const rev = renderToString(
      new ProgressBar({ total: 100, current: 30, status: 'review' }),
      20,
      1,
    );
    const ok = renderToString(
      new ProgressBar({ total: 100, current: 30 }),
      20,
      1,
    );
    expect(rev).not.toBe(ok);
  });

  test('status=backlog legacy yields distinct output from default at same fill', () => {
    const bl = renderToString(
      new ProgressBar({ total: 100, current: 30, status: 'backlog' }),
      20,
      1,
    );
    const ok = renderToString(
      new ProgressBar({ total: 100, current: 30 }),
      20,
      1,
    );
    expect(bl).not.toBe(ok);
  });
});

describe('FU I ProgressBar — theme-aware', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('theme-aware fill uses semantic.success by default', () => {
    const bar = new ProgressBar({ total: 100, current: 60, theme: ROSE_PINE_DAWN });
    const out = renderToString(bar, 20, 1);
    const success = resolveSemantic(ROSE_PINE_DAWN, 'success');
    expect(out).toContain(hexTriple(success.fg));
  });

  test('status=error + theme → critical semantic', () => {
    const bar = new ProgressBar({
      total: 100,
      current: 50,
      status: 'error',
      theme: CATPPUCCIN_LATTE,
    });
    const out = renderToString(bar, 20, 1);
    const crit = resolveSemantic(CATPPUCCIN_LATTE, 'critical');
    expect(out).toContain(hexTriple(crit.fg));
  });

  test('status=review + theme → warning semantic', () => {
    const bar = new ProgressBar({
      total: 100,
      current: 40,
      status: 'review',
      theme: NORD_LIGHT,
    });
    const out = renderToString(bar, 20, 1);
    const warn = resolveSemantic(NORD_LIGHT, 'warning');
    expect(out).toContain(hexTriple(warn.fg));
  });

  test('status=running + theme → info semantic', () => {
    const bar = new ProgressBar({
      total: 100,
      current: 20,
      status: 'running',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = renderToString(bar, 20, 1);
    const info = resolveSemantic(ELANOUS_PASTEL_DEFAULT, 'info');
    expect(out).toContain(hexTriple(info.fg));
  });

  test('cross-theme differs for same status', () => {
    const mochaBar = new ProgressBar({
      total: 100,
      current: 50,
      status: 'error',
      theme: CATPPUCCIN_MOCHA,
    });
    const latteBar = new ProgressBar({
      total: 100,
      current: 50,
      status: 'error',
      theme: CATPPUCCIN_LATTE,
    });
    const outMocha = renderToString(mochaBar, 20, 1);
    const outLatte = renderToString(latteBar, 20, 1);
    expect(outMocha).not.toBe(outLatte);
  });
});

// ─── ListView ──────────────────────────────────────────────────────

describe('FU I ListView — backward compat (no theme)', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('header + rows render without theme', () => {
    const list = new ListView({
      columns: [{ title: 'name' }, { title: 'value', width: 8 }],
      rows: [{ name: 'foo', value: '1' }, { name: 'bar', value: '2' }],
      render: (r) => [r.name, r.value],
    });
    const out = renderToString(list, 30, 5);
    expect(out).toContain('name');
    expect(out).toContain('value');
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });

  test('focused + cursor row produces ANSI decoration vs unfocused', () => {
    const focused = new ListView({
      columns: [{ title: 'x' }],
      rows: [{ x: 'a' }, { x: 'b' }],
      render: (r) => [r.x],
    });
    focused.takeFocus();
    const unfocused = new ListView({
      columns: [{ title: 'x' }],
      rows: [{ x: 'a' }, { x: 'b' }],
      render: (r) => [r.x],
    });
    const outFocused = renderToString(focused, 20, 4, true);
    const outUnfocused = renderToString(unfocused, 20, 4, false);
    // Focused output should differ from unfocused (cursor row styled).
    expect(outFocused).not.toBe(outUnfocused);
  });
});

describe('FU I ListView — theme-aware', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('theme cursor row uses selectView.cursor fg', () => {
    const list = new ListView({
      columns: [{ title: 'x' }],
      rows: [{ x: 'a' }, { x: 'b' }],
      render: (r) => [r.x],
      theme: ROSE_PINE_DAWN,
    });
    list.takeFocus();
    const out = renderToString(list, 20, 4);
    const cursor = resolveWidgetTokens(ROSE_PINE_DAWN, 'selectView').cursor;
    expect(out).toContain(hexTriple(cursor.fg));
  });

  test('theme header uses semantic.muted + bold', () => {
    const list = new ListView({
      columns: [{ title: 'LABEL' }],
      rows: [],
      render: () => [],
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = renderToString(list, 20, 2);
    const muted = resolveSemantic(ELANOUS_PASTEL_DEFAULT, 'muted');
    expect(out).toContain(hexTriple(muted.fg));
    // Phase D-2 emits bold + fg as a single combined SGR (`\x1b[1;38;2;...m`);
    // match the bold code as a semicolon-or-close-delimited token.
    expect(out).toMatch(/\x1b\[1[;m]/);
  });

  test('cross-theme changes cursor color', () => {
    const mochaList = new ListView({
      columns: [{ title: 'x' }],
      rows: [{ x: 'a' }],
      render: (r) => [r.x],
      theme: CATPPUCCIN_MOCHA,
    });
    const latteList = new ListView({
      columns: [{ title: 'x' }],
      rows: [{ x: 'a' }],
      render: (r) => [r.x],
      theme: CATPPUCCIN_LATTE,
    });
    mochaList.takeFocus();
    latteList.takeFocus();
    const outMocha = renderToString(mochaList, 20, 2);
    const outLatte = renderToString(latteList, 20, 2);
    expect(outMocha).not.toBe(outLatte);
  });
});

// ─── SelectView ───────────────────────────────────────────────────

describe('FU I SelectView — backward compat (no theme)', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('renders options + cursor without theme', () => {
    const sel = new SelectView({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      onSubmit: () => {},
    });
    sel.takeFocus();
    const out = renderToString(sel, 30, 6);
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    // IDX-F8 — cursor indicator ▸
    expect(out).toContain('▸');
  });
});

describe('FU I SelectView — theme-aware cursor', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('theme cursor uses selectView.cursor token', () => {
    const sel = new SelectView({
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
      theme: ROSE_PINE_DAWN,
    });
    sel.takeFocus();
    const out = renderToString(sel, 30, 4);
    const cursor = resolveWidgetTokens(ROSE_PINE_DAWN, 'selectView').cursor;
    expect(out).toContain(hexTriple(cursor.fg));
  });

  test('cross-theme differentiation on cursor color', () => {
    const makeView = (theme: ThemeTokens) =>
      new SelectView({
        options: [{ value: 'a', label: 'Alpha' }],
        onSubmit: () => {},
        theme,
      });
    const mochaView = makeView(CATPPUCCIN_MOCHA);
    const latteView = makeView(CATPPUCCIN_LATTE);
    mochaView.takeFocus();
    latteView.takeFocus();
    const outMocha = renderToString(mochaView, 30, 4);
    const outLatte = renderToString(latteView, 30, 4);
    expect(outMocha).not.toBe(outLatte);
  });
});
