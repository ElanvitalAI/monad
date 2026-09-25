import type { PreviewTerminal } from '../../preview/terminal.js';
import type { Key } from '../../tui.js';

export type PreviewTerminalKeyAction =
  | { kind: 'quit-app' }
  | { kind: 'close-and-focus-log' }
  | { kind: 'toggle-expand' }
  | { kind: 'scroll-page-up' }
  | { kind: 'scroll-page-down' }
  | { kind: 'scroll-top' }
  | { kind: 'scroll-tail' }
  | { kind: 'write-raw'; raw: string };

export type PreviewTerminalKeyRouteResult =
  | { type: 'handled' }
  | { type: 'quit' };

export function matchPreviewTerminalKeyAction(key: Key): PreviewTerminalKeyAction | null {
  if (key.ctrl && (key.name === 'q' || key.name === 'ㅂ')) {
    return { kind: 'quit-app' };
  }
  if (key.ctrl && (key.name === 'g' || key.name === 'ㅎ')) {
    return { kind: 'close-and-focus-log' };
  }
  // Ctrl+Shift+T is intentionally NOT bound here — the inline preview
  // terminal forwards it to the child PTY so the user's shell-level
  // Ctrl+T helpers (fzf-style file finder) keep working when shift is
  // accidentally held. The dashboard-level "exit terminal mode" path
  // is now expressed only by Ctrl+G (close + focus log) and Ctrl+Q
  // (quit app). This avoids stealing a key the user may have bound to
  // a Shift-variant of their terminal finder.
  if (key.ctrl && (
    (key.shift && (key.name === 'e' || key.name === 'E' || key.name === 'ㄷ'))
    // 'ㄸ' = Shift+'ㄷ' — shift may be implicit (한글 IME 2-bul layout).
    || key.name === 'ㄸ'
  )) {
    return { kind: 'toggle-expand' };
  }
  if (key.shift && key.name === 'pageup') {
    return { kind: 'scroll-page-up' };
  }
  if (key.shift && key.name === 'pagedown') {
    return { kind: 'scroll-page-down' };
  }
  if (key.shift && key.name === 'home') {
    return { kind: 'scroll-top' };
  }
  if (key.shift && key.name === 'end') {
    return { kind: 'scroll-tail' };
  }
  if (key.raw) {
    return { kind: 'write-raw', raw: key.raw };
  }
  return null;
}

export interface PreviewTerminalKeyRouteDeps {
  term: PreviewTerminal;
  closeTerminalForQuit: () => void;
  closeTerminalAndFocusLog: () => void;
  toggleExpand: () => void;
  redraw: () => void;
  quitApp: () => void;
}

export function handlePreviewTerminalKey(
  key: Key,
  deps: PreviewTerminalKeyRouteDeps,
): PreviewTerminalKeyRouteResult | null {
  const action = matchPreviewTerminalKeyAction(key);
  if (!action) return null;

  switch (action.kind) {
    case 'quit-app':
      deps.closeTerminalForQuit();
      deps.quitApp();
      return { type: 'quit' };
    case 'close-and-focus-log':
      deps.closeTerminalAndFocusLog();
      return { type: 'handled' };
    case 'toggle-expand':
      deps.toggleExpand();
      return { type: 'handled' };
    case 'scroll-page-up':
      deps.term.scrollUp(Math.max(1, deps.term.rows - 1));
      deps.redraw();
      return { type: 'handled' };
    case 'scroll-page-down':
      deps.term.scrollDown(Math.max(1, deps.term.rows - 1));
      deps.redraw();
      return { type: 'handled' };
    case 'scroll-top':
      deps.term.scrollToTop();
      deps.redraw();
      return { type: 'handled' };
    case 'scroll-tail':
      deps.term.scrollToTail();
      deps.redraw();
      return { type: 'handled' };
    case 'write-raw':
      if (deps.term.isScrolledBack) deps.term.scrollToTail();
      deps.term.write(action.raw);
      return { type: 'handled' };
  }
}
