// Global addressing — VW-P1.
//
// Every virtual window and pane gets a stable string address that
// survives layout mutations + cross-window moves. Callers resolve
// addresses into live objects via the address book. Parsing is
// permissive (accepts the bare `pane:xyz`, the qualified
// `win:N/pane:xyz`, or the explicit `@win:N` / `@pane:xyz` forms
// the AI tools use in prompts).
//
// Design notes:
//   • Pane ids are 6-hex-char random. Birthday-problem at 16M ids
//     is fine for a session that tops out at MAX_WINDOWS*
//     MAX_PANES_PER_WINDOW = 144 simultaneous panes.
//   • Window ids are sequential integers (stable until close) so
//     users can say "switch to window 3" without hunting a hash.
//   • The registry is a simple Map pair — keeps lookup O(1) and
//     makes testing trivial (createAddressBook() per test).

import { randomBytes } from 'node:crypto';

export type WindowId = number;
export type PaneId = string;

export interface WindowRef {
  readonly id: WindowId;
  readonly title: string;
}
export interface PaneRef {
  readonly id: PaneId;
  readonly windowId: WindowId;
  readonly kind: string;       // 'terminal' | 'markdown' | ...
}

/** Parsed address. Fields are present only when the input mentions
 *  them — `@win:3` yields {windowId:3}, `@pane:abc` yields {paneId},
 *  `win:3/pane:abc` yields both. */
export interface ParsedAddress {
  raw: string;
  windowId?: WindowId;
  paneId?: PaneId;
}

/** Regex split:
 *    (?:@)? leading @ optional
 *    (?:win:(\d+))? window segment
 *    (?:\/?pane:([0-9a-fA-F]+))? pane segment
 *  Captures window id in group 1 and pane id in group 2. */
const ADDR_RE = /^@?(?:win:(\d+))?(?:\/?pane:([A-Za-z0-9_-]+))?$/;

export function parseAddress(raw: string): ParsedAddress | null {
  const trimmed = raw.trim();
  const m = ADDR_RE.exec(trimmed);
  if (!m) return null;
  const windowId = m[1] ? parseInt(m[1], 10) : undefined;
  const paneId = m[2] ? m[2] : undefined;
  if (windowId === undefined && paneId === undefined) return null;
  return { raw: trimmed, windowId, paneId };
}

export function formatWindowAddress(id: WindowId): string {
  return `win:${id}`;
}

export function formatPaneAddress(id: PaneId): string {
  return `pane:${id}`;
}

export function formatFullAddress(winId: WindowId, paneId: PaneId): string {
  return `win:${winId}/pane:${paneId}`;
}

/** Mint a fresh pane id. 6 hex chars = 24 bits. */
export function mintPaneId(): string {
  return randomBytes(3).toString('hex');
}

// ─── AddressBook ──────────────────────────────────────────────────

export interface AddressBookEntry<W extends WindowRef, P extends PaneRef> {
  window: W;
  panes: Map<PaneId, P>;
}

export interface AddressBook<
  W extends WindowRef = WindowRef,
  P extends PaneRef = PaneRef,
> {
  registerWindow(window: W): void;
  unregisterWindow(id: WindowId): void;
  registerPane(pane: P): void;
  unregisterPane(paneId: PaneId): void;

  resolveWindow(idOrAddr: WindowId | string): W | null;
  resolvePane(idOrAddr: PaneId | string): P | null;
  listWindows(): W[];
  listPanes(windowId?: WindowId): P[];

  /** Parse + resolve in one step. Returns whatever resolved; either
   *  field is null when missing or unresolvable. */
  parse(raw: string): { window: W | null; pane: P | null; parsed: ParsedAddress | null };

  nextWindowId(): WindowId;
  reset(): void;
}

export function createAddressBook<
  W extends WindowRef = WindowRef,
  P extends PaneRef = PaneRef,
>(): AddressBook<W, P> {
  let nextWindowIdCounter = 1;
  const windows = new Map<WindowId, W>();
  const panes = new Map<PaneId, P>();

  const resolveWindowInternal = (idOrAddr: WindowId | string): W | null => {
    if (typeof idOrAddr === 'number') return windows.get(idOrAddr) ?? null;
    const parsed = parseAddress(idOrAddr);
    if (!parsed) return null;
    if (parsed.windowId !== undefined) return windows.get(parsed.windowId) ?? null;
    if (parsed.paneId !== undefined) {
      const pane = panes.get(parsed.paneId);
      if (!pane) return null;
      return windows.get(pane.windowId) ?? null;
    }
    return null;
  };

  const resolvePaneInternal = (idOrAddr: PaneId | string): P | null => {
    if (typeof idOrAddr !== 'string') return null;
    // Bare id shortcut (user typed just the identifier without
    // prefix). Accept any registered key as a fast-path.
    if (panes.has(idOrAddr)) return panes.get(idOrAddr) ?? null;
    const parsed = parseAddress(idOrAddr);
    if (!parsed?.paneId) return null;
    return panes.get(parsed.paneId) ?? null;
  };

  return {
    registerWindow(window) {
      windows.set(window.id, window);
      if (window.id >= nextWindowIdCounter) nextWindowIdCounter = window.id + 1;
    },
    unregisterWindow(id) {
      windows.delete(id);
      // Cascade: drop panes belonging to this window.
      for (const [paneId, pane] of panes) {
        if (pane.windowId === id) panes.delete(paneId);
      }
    },
    registerPane(pane) {
      panes.set(pane.id, pane);
    },
    unregisterPane(paneId) {
      panes.delete(paneId);
    },
    resolveWindow: resolveWindowInternal,
    resolvePane: resolvePaneInternal,
    listWindows() { return [...windows.values()]; },
    listPanes(windowId) {
      const all = [...panes.values()];
      return windowId === undefined ? all : all.filter(p => p.windowId === windowId);
    },
    parse(raw) {
      const parsed = parseAddress(raw);
      if (!parsed) return { window: null, pane: null, parsed: null };
      const window = parsed.windowId !== undefined
        ? windows.get(parsed.windowId) ?? null
        : parsed.paneId
          ? (panes.get(parsed.paneId)?.windowId !== undefined
            ? windows.get(panes.get(parsed.paneId)!.windowId) ?? null
            : null)
          : null;
      const pane = parsed.paneId ? panes.get(parsed.paneId) ?? null : null;
      return { window, pane, parsed };
    },
    nextWindowId() {
      return nextWindowIdCounter++;
    },
    reset() {
      windows.clear();
      panes.clear();
      nextWindowIdCounter = 1;
    },
  };
}

// Singleton — dashboard wires into it at init, tests use
// createAddressBook() instead for isolation.
let _global: AddressBook | null = null;
export function getGlobalAddressBook(): AddressBook {
  if (!_global) _global = createAddressBook();
  return _global;
}
export function _resetGlobalAddressBookForTesting(): void {
  _global = null;
}
