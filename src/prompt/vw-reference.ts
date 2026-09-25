// @pane:<id> / @win:<N> prompt expansion — T2-P2.
//
// Sibling of prompt-term-reference.ts; handles VirtualWindow
// addresses. Pure synchronous replacement (no OCR). Recognized
// token forms:
//
//   @pane:<id>                — single-pane capture, default tail
//   @pane:<id>#<N>            — last N bytes
//   @pane:<id>#all            — full capture (unsliced)
//   @win:<N>/pane:<id>        — qualified pane capture, same modes
//   @win:<N>                  — window summary (title + pane list)
//   @win:<N>#all              — capture every pane in the window
//
// Unknown ids pass through untouched so the LLM + user can tell
// what went wrong. Captures come from the host-registered
// paneContentLookup (same hook PaneCapture uses) — the expander
// never imports virtual-window internals.
//
// Output (pane):
//   <pane addr="pane:abc" kind="terminal" window="win:2">
//   <last-N>...</last-N>
//   </pane>
//
// Output (window summary):
//   <window addr="win:2" title="build" panes="3">
//   <pane addr="pane:abc" kind="terminal" />
//   ...
//   </window>

import type { AddressBook, PaneRef, WindowRef } from '../virtual-windows/addressing.js';

const DEFAULT_TAIL_BYTES = 4 * 1024;

// Matches the whole address (win / pane / qualified) with an
// optional #mode suffix. Trailing lookahead handles sentence
// punctuation so "@pane:abc." doesn't swallow the period.
const TOKEN_RE = /@((?:win:\d+(?:\/pane:[A-Za-z0-9_-]+)?)|(?:pane:[A-Za-z0-9_-]+))(?:#(\d+|all))?(?=\s|$|[.,!?;)])/g;

export interface VWExpandDeps {
  addressBook: AddressBook;
  /** Same contract as registerPaneContentLookup — returns an object
   *  with .capture() for the given pane id, or null. */
  paneLookup: (paneId: string) => { capture: () => string; kind?: string } | null;
  /** Enumerate panes in a window. Used for @win:<N>#all and
   *  @win:<N> summary. */
  listPanes?: (winId: number) => Array<{ id: string; kind: string }>;
}

export interface VWExpandOpts {
  defaultTailBytes?: number;
}

export function expandVirtualWindowReferences(
  input: string,
  deps: VWExpandDeps,
  opts: VWExpandOpts = {},
): string {
  if (!input.includes('@')) return input;
  const defaultTail = opts.defaultTailBytes ?? DEFAULT_TAIL_BYTES;

  return input.replace(TOKEN_RE, (match, address: string, mode: string | undefined) => {
    const parsed = deps.addressBook.parse(address);
    if (!parsed.parsed) return match;

    // @win:<N>  OR  @win:<N>#all  — window-level tokens.
    if (parsed.parsed.windowId !== undefined && parsed.parsed.paneId === undefined) {
      const window = parsed.window as WindowRef | null;
      if (!window) return match;
      if (mode === 'all') {
        return renderWindowAllPanes(window, deps, defaultTail);
      }
      return renderWindowSummary(window, deps);
    }

    // @pane:<id>  OR  @win:<N>/pane:<id>
    if (parsed.parsed.paneId !== undefined) {
      const pane = parsed.pane as PaneRef | null;
      if (!pane) return match;
      const content = deps.paneLookup(pane.id);
      if (!content) return match;
      return renderPaneCapture(pane, content.capture(), mode, defaultTail);
    }

    return match;
  });
}

function renderPaneCapture(
  pane: PaneRef,
  body: string,
  mode: string | undefined,
  defaultTail: number,
): string {
  let label: string;
  let rendered = body;
  if (mode === 'all') {
    label = 'full';
  } else {
    const tailBytes = mode ? Math.max(1, parseInt(mode, 10)) : defaultTail;
    if (rendered.length > tailBytes) {
      rendered = rendered.slice(-tailBytes);
      label = `last-${tailBytes}`;
    } else {
      label = `full-${rendered.length}`;
    }
  }
  return (
    `<pane addr="pane:${pane.id}" kind="${escapeAttr(pane.kind)}" window="win:${pane.windowId}">\n` +
    `<${label}>\n${rendered}\n</${label}>\n` +
    `</pane>`
  );
}

function renderWindowSummary(window: WindowRef, deps: VWExpandDeps): string {
  const panes = deps.listPanes?.(window.id) ?? [];
  const paneLines = panes
    .map((p) => `<pane addr="pane:${p.id}" kind="${escapeAttr(p.kind)}" />`)
    .join('\n');
  return (
    `<window addr="win:${window.id}" title="${escapeAttr(window.title)}" panes="${panes.length}">\n` +
    (paneLines ? `${paneLines}\n` : '') +
    `</window>`
  );
}

function renderWindowAllPanes(
  window: WindowRef,
  deps: VWExpandDeps,
  defaultTail: number,
): string {
  const panes = deps.listPanes?.(window.id) ?? [];
  const bodies = panes.map((p) => {
    const content = deps.paneLookup(p.id);
    if (!content) {
      return `<pane addr="pane:${p.id}" kind="${escapeAttr(p.kind)}" empty="unavailable" />`;
    }
    return renderPaneCapture(
      { id: p.id, kind: p.kind, windowId: window.id },
      content.capture(),
      undefined,
      defaultTail,
    );
  });
  return (
    `<window addr="win:${window.id}" title="${escapeAttr(window.title)}" panes="${panes.length}">\n` +
    (bodies.length > 0 ? bodies.join('\n') + '\n' : '') +
    `</window>`
  );
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
