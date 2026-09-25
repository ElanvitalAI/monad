// ── Preview pager (Track J) ──
//
// Wraps showPreviewModal with navigation state so j/k cycles PDF
// pages / video frames via the handler's `skip` field. Pure in the
// sense that input/output shapes are test-friendly; dashboard wires
// `handleKey` from its readKey loop when a pager is active.
//
// Design:
//   • openPager(absPath, deps)   — build + render first page
//   • pager.next()               — skip++, re-render in place
//   • pager.prev()               — skip--, clamped at 0
//   • pager.close()              — dispose modal + clear state
//   • pager.handleKey(name)      — 'j' / ' ' next, 'k' prev, 'q'|'esc' close
//
// The pager is single-instance per dashboard — opening a second one
// closes the first. Reuses the 'image-preview' modal group so the
// transient flash modal (clipboard paste) doesn't race.

import type { DisplayCoordinator } from '../display/coordinator.js';
import type { ShowPreviewModalOpts, ShowPreviewModalReturn } from '../dashboard/modals/preview.js';
import { showPreviewModal } from '../dashboard/modals/preview.js';

export interface PreviewPagerDeps {
  coordinator: DisplayCoordinator;
  termSize: () => { cols: number; rows: number };
  /** Rendered after every page change — dashboard passes the chat-log
   *  push + draw so the user sees "page 3/? · j/k to page · q to
   *  close" inline. Optional; pager runs silently when omitted. */
  onPageChange?: (label: string) => void;
  /** Test DI — swap the modal renderer without monkey-patching ESM
   *  exports. Defaults to showPreviewModal. */
  showFn?: (path: string, opts: ShowPreviewModalOpts) => Promise<ShowPreviewModalReturn | null>;
}

export interface PreviewPager {
  readonly absPath: string;
  readonly skip: number;
  readonly alive: boolean;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
  /** Key handler — returns true when the key was consumed. Dashboard
   *  calls this AFTER its own modal chain and BEFORE the chord
   *  dispatch so pager keys don't conflict with other windows. */
  handleKey(name: string): Promise<boolean>;
}

let _current: PreviewPager | null = null;

/** Process-wide singleton accessor. Dashboard uses this to route keys. */
export function getActivePager(): PreviewPager | null {
  return _current;
}

/** Test reset. */
export function _resetPagerForTesting(): void {
  try { _current?.close(); } catch { /* ignore */ }
  _current = null;
}

export async function openPager(
  absPath: string,
  deps: PreviewPagerDeps,
): Promise<PreviewPager | null> {
  // Replace any existing pager.
  try { _current?.close(); } catch { /* ignore */ }
  _current = null;

  let skip = 0;
  let alive = true;
  let currentModal: ShowPreviewModalReturn | null = null;

  const show = deps.showFn ?? showPreviewModal;
  const render = async (): Promise<void> => {
    if (!alive) return;
    const { cols, rows } = deps.termSize();
    currentModal = await show(absPath, {
      coordinator: deps.coordinator,
      termCols: cols,
      termRows: rows,
      skip,
      ttlMs: 0,               // persistent — pager owns dismissal
    });
    if (deps.onPageChange) {
      const label = skip === 0 ? `preview: ${absPath}` : `preview: ${absPath} · skip=${skip}`;
      deps.onPageChange(`${label} · j/k page · q close`);
    }
  };

  await render();
  if (!currentModal) { alive = false; return null; }

  const pager: PreviewPager = {
    absPath,
    get skip() { return skip; },
    get alive() { return alive; },
    async next(): Promise<void> {
      if (!alive) return;
      skip += 1;
      await render();
    },
    async prev(): Promise<void> {
      if (!alive || skip === 0) return;
      skip -= 1;
      await render();
    },
    close(): void {
      if (!alive) return;
      alive = false;
      try { currentModal?.handle.dispose(); } catch { /* ignore */ }
      currentModal = null;
      if (_current === pager) _current = null;
    },
    async handleKey(name): Promise<boolean> {
      if (!alive) return false;
      const k = name.toLowerCase();
      if (k === 'j' || k === ' ' || k === 'space' || k === 'pagedown') {
        await pager.next();
        return true;
      }
      if (k === 'k' || k === 'pageup') {
        await pager.prev();
        return true;
      }
      if (k === 'q' || k === 'esc' || k === 'escape') {
        pager.close();
        return true;
      }
      return false;
    },
  };

  _current = pager;
  return pager;
}
