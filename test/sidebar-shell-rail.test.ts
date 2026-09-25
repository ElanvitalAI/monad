import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { renderSidebarShellRailRow } from '../src/ui/chrome/sidebar-shell-rail.js';

describe('sidebar shell rail presentation', () => {
  test('inactive rows stay plain muted text', () => {
    const raw = renderSidebarShellRailRow('○ Theme', false, false);
    expect(stripAnsi(raw)).toBe('○ Theme');
  });

  test('active focused rows receive a highlighted treatment', () => {
    const raw = renderSidebarShellRailRow('● Theme', true, true);
    expect(stripAnsi(raw)).toBe('● Theme');
  });

  test('active unfocused rows still keep a softer highlighted treatment', () => {
    const raw = renderSidebarShellRailRow('● Theme', true, false);
    expect(stripAnsi(raw)).toBe('● Theme');
  });
});
