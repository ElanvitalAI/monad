import type { Key } from '../../tui.js';

/**
 * Match global dashboard view-switch shortcuts.
 *
 * Most terminals report `Ctrl+<digit>` through Kitty/xterm modified-key
 * protocols and we see `key.name === '<digit>'`. Plain xterm / tmux can
 * collapse `Ctrl+7` onto the same `0x1f` wire form as `Ctrl+/`, which the
 * parser normalizes to `{ name: '/', ctrl: true }`. Accept that as a V7
 * fallback so the Widget Playground remains reachable without requiring
 * `/view 7`.
 */
export function matchDashboardViewShortcut(key: Key): string | null {
  if (!key.ctrl || key.shift || key.alt) return null;
  if (/^[1-9]$/.test(key.name)) return key.name;
  if (key.name === '/') return '7';
  return null;
}
