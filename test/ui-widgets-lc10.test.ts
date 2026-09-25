import { describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { FileDialog, type FileEntry } from '../src/ui/widgets/file-dialog.js';
import { ProgressBar } from '../src/ui/widgets/progress-bar.js';
import { Tooltip, tooltipPlacement } from '../src/ui/widgets/tooltip.js';
import { CATPPUCCIN_MOCHA, ROSE_PINE_DAWN } from '../src/themes/index.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function render(v: { draw: (p: Printer) => void }, w = 50, h = 10, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  v.draw(p);
  return p.lines().map(stripAnsi);
}

async function nextTick(): Promise<void> {
  await new Promise(r => setTimeout(r, 5));
}

function makeFs(map: Record<string, FileEntry[]>) {
  return (path: string): FileEntry[] => map[path] ?? [];
}

describe('LC10 FileDialog', () => {
  test('renders current dir entries + breadcrumb title', async () => {
    const fs = makeFs({
      '/': [
        { name: 'src',     isDirectory: true },
        { name: 'a.txt',   isDirectory: false },
        { name: '.hidden', isDirectory: false, hidden: true },
      ],
    });
    const d = new FileDialog({ startDir: '/', mode: 'open', readDir: fs, onSubmit: () => {} });
    d.takeFocus();
    await nextTick();
    const lines = render(d, 50, 10);
    const joined = lines.join('\n');
    expect(joined).toContain('Open — /');
    expect(joined).toContain('src/');
    expect(joined).toContain('a.txt');
    expect(joined).not.toContain('.hidden');
  });

  test('navigates into a directory on Enter', async () => {
    const fs = makeFs({
      '/':    [{ name: 'sub', isDirectory: true }, { name: '..', isDirectory: true }],
      '/sub': [{ name: 'deep.txt', isDirectory: false }],
    });
    const d = new FileDialog({ startDir: '/', mode: 'open', readDir: fs, onSubmit: () => {} });
    d.takeFocus();
    await nextTick();
    // cursor is on '..' by default; press down to get to sub
    d.onEvent(key('down'));
    d.onEvent(key('enter'));
    await nextTick();
    expect(d._state().cwd).toBe('/sub');
  });

  test('open mode submits full path on file Enter', async () => {
    const fs = makeFs({
      '/': [{ name: 'hello.txt', isDirectory: false }],
    });
    let picked: string | null = null;
    const d = new FileDialog({
      startDir: '/', mode: 'open', readDir: fs,
      onSubmit: p => { picked = p; },
    });
    d.takeFocus();
    await nextTick();
    d.onEvent(key('down'));           // skip '..'
    d.onEvent(key('enter'));
    expect(picked).toBe('/hello.txt');
  });

  test('dir mode picks current dir on Ctrl+Enter', async () => {
    const fs = makeFs({ '/work': [] });
    let picked: string | null = null;
    const d = new FileDialog({
      startDir: '/work', mode: 'dir', readDir: fs,
      onSubmit: p => { picked = p; },
    });
    d.takeFocus();
    await nextTick();
    d.onEvent(key('enter', { ctrl: true }));
    expect(picked).toBe('/work');
  });

  test('parent navigation via ..', async () => {
    const fs = makeFs({
      '/home':      [{ name: 'alice', isDirectory: true }],
      '/home/alice': [{ name: 'f.txt', isDirectory: false }],
    });
    const d = new FileDialog({ startDir: '/home/alice', mode: 'open', readDir: fs, onSubmit: () => {} });
    d.takeFocus();
    await nextTick();
    // cursor on '..'
    d.onEvent(key('enter'));
    await nextTick();
    expect(d._state().cwd).toBe('/home');
  });

  test('showHidden exposes dotfiles', async () => {
    const fs = makeFs({
      '/': [{ name: '.env', isDirectory: false }],
    });
    const d = new FileDialog({
      startDir: '/', mode: 'open', readDir: fs, showHidden: true, onSubmit: () => {},
    });
    d.takeFocus();
    await nextTick();
    const lines = render(d, 40, 6);
    expect(lines.join('\n')).toContain('.env');
  });

  test('chromeSpec overrides title and can hide close glyph', async () => {
    const fs = makeFs({
      '/': [{ name: 'hello.txt', isDirectory: false }],
    });
    const d = new FileDialog({
      startDir: '/',
      mode: 'open',
      readDir: fs,
      chromeSpec: { title: 'Spec file picker', showClose: false, variant: 'panel' },
      onSubmit: () => {},
    });
    d.takeFocus();
    await nextTick();
    const lines = render(d, 40, 6);
    const joined = lines.join('\n');
    expect(joined).toContain('Spec file picker');
    expect(joined).not.toContain('×');
  });
});

describe('LC10 ProgressBar', () => {
  test('percent calculation', () => {
    const pb = new ProgressBar({ total: 200, current: 50 });
    expect(pb.percent).toBe(25);
  });

  test('renders filled + empty portions + percent', () => {
    const pb = new ProgressBar({ total: 10, current: 4 });
    const lines = render(pb, 20, 1);
    expect(lines[0]).toContain('%');
  });

  test('update mutates current', () => {
    const pb = new ProgressBar({ total: 10, current: 2 });
    pb.update({ current: 7 });
    expect(pb.percent).toBe(70);
  });

  test('update caps current at total', () => {
    const pb = new ProgressBar({ total: 10, current: 0 });
    pb.update({ current: 99 });
    expect(pb.percent).toBe(100);
  });

  test('does not take focus', () => {
    const pb = new ProgressBar({ total: 1 });
    expect(pb.takeFocus()).toBe(false);
  });

  test('label gets its own row', () => {
    const pb = new ProgressBar({ total: 10, current: 3, label: 'building' });
    const lines = render(pb, 30, 2);
    expect(lines[0]).toContain('building');
    expect(lines[1]).toContain('%');
  });
});

describe('LC10 Tooltip', () => {
  test('renders text with brackets', () => {
    const t = new Tooltip({ text: 'help' });
    const lines = render(t, 20, 1);
    expect(lines[0]).toContain('help');
  });

  test('multiline text renders across rows', () => {
    const t = new Tooltip({ text: 'line1\nline2' });
    const lines = render(t, 20, 2);
    expect(lines[0]).toContain('line1');
    expect(lines[1]).toContain('line2');
  });

  test('isExpired respects ttlMs', () => {
    let now = 1000;
    const t = new Tooltip({ text: 'x', ttlMs: 500, nowMs: () => now });
    expect(t.isExpired()).toBe(false);
    now += 600;
    expect(t.isExpired()).toBe(true);
  });

  test('does not take focus', () => {
    expect(new Tooltip({ text: 'x' }).takeFocus()).toBe(false);
  });

  test('truncates overly long line with ellipsis', () => {
    const t = new Tooltip({ text: 'abcdefghijklmnop' });
    const lines = render(t, 8, 1);
    expect(lines[0]).toContain('…');
  });

  test('chromeSpec wraps tooltip in declarative chrome', () => {
    const t = new Tooltip({
      text: 'hover help',
      theme: CATPPUCCIN_MOCHA,
      chromeSpec: { title: 'Spec hint', showClose: false, variant: 'tooltip' },
    });
    const lines = render(t, 24, 4);
    const joined = lines.join('\n');
    expect(joined).toContain('Spec hint');
    expect(joined).toContain('hover help');
    expect(joined).not.toContain('×');
  });
});

describe('LC10 tooltipPlacement', () => {
  test('prefers right+below of anchor', () => {
    const r = tooltipPlacement({ x: 5, y: 5 }, { width: 8, height: 2 }, { width: 40, height: 20 });
    expect(r).toEqual({ x: 6, y: 6, width: 8, height: 2 });
  });

  test('flips left when anchor too close to right edge', () => {
    const r = tooltipPlacement({ x: 35, y: 5 }, { width: 10, height: 2 }, { width: 40, height: 20 });
    expect(r.x).toBeLessThan(35);
  });

  test('flips above when anchor near bottom', () => {
    const r = tooltipPlacement({ x: 5, y: 18 }, { width: 8, height: 4 }, { width: 40, height: 20 });
    expect(r.y).toBeLessThan(18);
  });
});

describe('LC10 ToastStack theme', () => {
  test('theme-aware toast output differs from the legacy unthemed path', async () => {
    const orig = chalk.level;
    try {
      chalk.level = 3;
      const { ToastStack } = await import('../src/ui/widgets/toast-stack.js');
      const p1 = Printer.create({ width: 40, height: 5 });
      const p2 = Printer.create({ width: 40, height: 5 });
      const themed = new ToastStack({ nowMs: () => 0, theme: CATPPUCCIN_MOCHA });
      const legacy = new ToastStack({ nowMs: () => 0 });
      themed.push({ text: 'saved', kind: 'success' });
      legacy.push({ text: 'saved', kind: 'success' });
      themed.render(p1);
      legacy.render(p2);
      const themedOut = p1.lines().join('\n');
      const legacyOut = p2.lines().join('\n');
      expect(themedOut).toContain('saved');
      expect(legacyOut).toContain('saved');
      expect(themedOut).not.toBe(legacyOut);
    } finally {
      chalk.level = orig;
    }
  });

  test('getTheme accessor follows live theme changes', async () => {
    const orig = chalk.level;
    try {
      chalk.level = 3;
      const { ToastStack } = await import('../src/ui/widgets/toast-stack.js');
      let theme = CATPPUCCIN_MOCHA;
      const p1 = Printer.create({ width: 40, height: 5 });
      const p2 = Printer.create({ width: 40, height: 5 });
      const stack = new ToastStack({ nowMs: () => 0, getTheme: () => theme });
      stack.push({ text: 'saved', kind: 'success' });
      stack.render(p1);
      theme = ROSE_PINE_DAWN;
      stack.render(p2);
      const out1 = p1.lines().join('\n');
      const out2 = p2.lines().join('\n');
      expect(out1).toContain('saved');
      expect(out2).toContain('saved');
      expect(out1).not.toBe(out2);
    } finally {
      chalk.level = orig;
    }
  });
});
