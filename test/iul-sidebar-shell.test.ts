import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { Printer } from '../src/ui/printer.js';
import { createIulSidebarShellPaneContent, createIulSidebarShellView } from '../src/iul/sidebar-shell.js';
import type { DisplayMouseEvent, KeyEvent } from '../src/display/types.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function mouse(type: MouseEvent['type'], x: number, y: number): MouseEvent {
  return { type, x, y, absX: x, absY: y };
}

function displayMouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('IUL sidebar shell', () => {
  test('shared view renders IUL title and first rail item', () => {
    const view = createIulSidebarShellView();
    view.layout({ width: 60, height: 14 });
    const printer = Printer.create({ width: 60, height: 14, focused: true });
    view.draw(printer);
    const out = printer.lines().map(stripAnsi).join('\n');
    expect(out).toContain('IUL UX Lab');
    expect(out).toContain('Test Lab');
    expect(out).toContain('YAML Editor');
    expect(out).toContain('Switch');
    expect(out).toContain('Theme:');
  });

  test('pane content renders and responds to keyboard selection changes', () => {
    const pane = createIulSidebarShellPaneContent({ kind: 'iul-shell', title: 'IUL UX Lab' });
    expect(pane.hostChromeProfile).toBe('dock-only');
    const first = pane.render({ cols: 92, rows: 18, focused: true });
    expect(stripAnsi(first)).toContain('Test Lab');
    expect(stripAnsi(first)).toContain('Change layout');
    expect(stripAnsi(first)).toContain('Theme:');

    const action = pane.onKey(key('down'));
    expect(action.type).toBe('refresh');

    const next = pane.capture();
    expect(next).toContain('YAML Editor');
    expect(next).toContain('Scenario YAML');
  });

  test('test lab theme picker can open without mutating the shell', () => {
    const pane = createIulSidebarShellPaneContent(
      { kind: 'iul-shell', title: 'IUL UX Lab' },
      {
        iulThemePreviewControl: {
          getActiveThemeName: () => 'catppuccin-mocha',
          previewTheme: () => {},
          revertPreview: () => {},
          commitTheme: () => {},
        },
      },
    );
    pane.render({ cols: 92, rows: 20, focused: true });
    pane.onKey(key('enter'));
    pane.onKey(key('down'));
    const capture = pane.capture();
    expect(capture).toContain('Theme');
  });

  test('test lab theme picker opens on click in the theme strip', () => {
    const view = createIulSidebarShellView();
    view.layout({ width: 92, height: 20 });
    const res = view.onMouse(mouse('click', 70, 2));
    expect(res.kind).toBe('consumed');
  });

  test('test lab theme strip ignores mouse-down as a raw capture signal', () => {
    const view = createIulSidebarShellView();
    view.layout({ width: 92, height: 20 });
    const res = view.onMouse(mouse('mouse-down', 70, 2));
    expect(res.kind).toBe('consumed');
  });

  test('pane content ignores raw release for menu-style mouse flows', () => {
    const pane = createIulSidebarShellPaneContent({ kind: 'iul-shell', title: 'IUL UX Lab' });
    pane.render({ cols: 92, rows: 20, focused: true });
    const res = pane.onMouse(displayMouse('release', 3, 70));
    expect(res.type).toBe('none');
  });

  test('can reach YAML editor lane through keyboard navigation', () => {
    const pane = createIulSidebarShellPaneContent({ kind: 'iul-shell', title: 'IUL UX Lab' });
    pane.render({ cols: 100, rows: 22, focused: true });
    pane.onKey(key('down'));
    const yamlEditor = pane.capture();
    expect(yamlEditor).toContain('YAML Editor');
    expect(yamlEditor).toContain('Scenario YAML');
  });
});
