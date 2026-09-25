// R-1/R-2/R-4 — xterm.js fit() trigger consolidator.
//
// xterm.js needs `FitAddon.fit()` whenever the host container's pixel
// dimensions change. Pre-existing wire only listened to `window.resize`,
// which misses three real cases on `/term`:
//
//   R-1 container resize  — split-pane drag, dock toggle, sidebar
//                           collapse. Window stays the same size; only
//                           the xterm `<div>` shrinks. ResizeObserver
//                           catches this; `window.resize` doesn't.
//   R-2 wire flooding     — drag-resize fires hundreds of pixel-level
//                           events. Each one previously sent an ACP
//                           `terminal/resize` frame to the daemon.
//                           Caller debounces the ACP send separately
//                           (see XtermView.tsx); this controller calls
//                           `onImmediate` synchronously every fire so
//                           the local fit().fit() + xterm redraw lands
//                           in the same animation frame as the resize
//                           event — matching ghostty/iTerm responsiveness.
//   R-4 mobile viewport   — iOS PWA standalone mode + iPad rotation +
//                           virtual keyboard show/hide don't always
//                           fire `window.resize`. visualViewport does.
//
// `onImmediate` runs every signal, no debounce. `onTrailing` (optional)
// fires once after the configured trailing-edge window — use it for
// expensive cross-process work (ACP frames, persistence) that doesn't
// need to keep up with drag-resize event rate.
//
// Forensic instrumentation (2026-05-07 dogfood follow-up): users have
// reported "browser resize doesn't refresh terminal" without a clear
// reproduction. The controller now emits a `webterm.resize.trigger`
// debug event on every fire — categorized by source (ro / win / vv) +
// duration of the immediate callback. Pair with the xterm cell-grid
// size before/after to spot cases where ResizeObserver fires but
// fit() can't keep up.

import { debugLog } from './debug';

export interface ResizeControllerOptions {
  /** Element whose pixel size to observe. */
  target: Element;
  /** Runs on every signal — sync, no debounce. Use this for `fit.fit()`
   *  so the xterm redraw lands in the same frame as the resize event. */
  onImmediate: () => void;
  /** Optional trailing-edge debounced callback. Use for expensive
   *  cross-process work (e.g. logging, persistence). The pre-existing
   *  ACP `terminal/resize` send is handled separately via
   *  `term.onResize({cols, rows})` which already self-debounces (it
   *  only fires when fit() actually changes the cell grid). */
  onTrailing?: () => void;
  /** Trailing-edge debounce window in ms for `onTrailing`. Default 32
   *  (~2 frames @ 60fps). */
  trailingDebounceMs?: number;
}

export interface ResizeControllerHandle {
  /** Tear down all observers and listeners. Idempotent. */
  dispose(): void;
  /** Force any pending trailing callback to run now. Used by tests. */
  flushPending(): void;
}

export function createXtermResizeController(
  opts: ResizeControllerOptions,
): ResizeControllerHandle {
  const debounceMs = opts.trailingDebounceMs ?? 32;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fireTrailing = (): void => {
    timer = null;
    if (disposed) return;
    if (!opts.onTrailing) return;
    try {
      opts.onTrailing();
    } catch {
      // Swallow — trailing work is best-effort.
    }
  };

  const trigger = (source: 'ro' | 'win' | 'vv'): void => {
    if (disposed) return;
    const t0 = performance.now();
    const box = (opts.target as HTMLElement | null)?.getBoundingClientRect?.();
    const width = box ? Math.round(box.width) : undefined;
    const height = box ? Math.round(box.height) : undefined;
    if (box?.height === 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      debugLog('webterm.resize.skip', {
        source,
        ...(width !== undefined ? { w: width } : {}),
        h: height,
        reason: 'zero-height',
      });
      return;
    }

    let immediateError: string | null = null;
    try {
      opts.onImmediate();
    } catch (e) {
      // Swallow — fit() throws when the container is mid-layout. The
      // next event will retry; nothing here is load-bearing. We *do*
      // capture the message into the debug log so a "resize stopped
      // working" report can show whether fit() was throwing.
      immediateError = e instanceof Error ? e.message : String(e);
    }
    debugLog('webterm.resize.trigger', {
      source,
      dt: Math.round((performance.now() - t0) * 100) / 100,
      ...(width !== undefined ? { w: width } : {}),
      ...(height !== undefined ? { h: height } : {}),
      ...(immediateError ? { err: immediateError } : {}),
    });
    if (opts.onTrailing) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fireTrailing, debounceMs);
    }
  };

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => trigger('ro'));
    observer.observe(opts.target);
  }

  const onWindowResize = (): void => trigger('win');
  window.addEventListener('resize', onWindowResize);

  const vv = typeof window !== 'undefined' ? window.visualViewport ?? null : null;
  const onVvResize = (): void => trigger('vv');
  if (vv) vv.addEventListener('resize', onVvResize);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // swallow
        }
        observer = null;
      }
      window.removeEventListener('resize', onWindowResize);
      if (vv) vv.removeEventListener('resize', onVvResize);
    },
    flushPending(): void {
      if (timer === null) return;
      clearTimeout(timer);
      fireTrailing();
    },
  };
}
