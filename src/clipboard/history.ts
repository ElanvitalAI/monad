// ── In-process clipboard history ──
//
// Polls the system clipboard at a configurable interval and stores
// unique text snapshots in an in-memory ring buffer. The dashboard's
// scratch pane "clipboard mode" renders this list so the user can
// scroll back through what they've copied during the session and
// re-promote any past entry to the live clipboard with one keypress.
//
// Why polling vs an OS event hook: macOS doesn't expose a clipboard-
// changed notification to userland binaries without entitlements.
// pbpaste at 1.5s cadence is cheap (sub-millisecond per call on a
// recent Mac) and the small lag is fine for "look back at what I
// copied 30s ago" use cases.
//
// Image entries: we already track a separate path-based registry for
// pasted screenshots (context.ts). This module is text-only by
// design — image previews live in the main scratchpad already.

import { readClipboardText, isClipboardSupported } from './index.js';

export interface ClipboardEntry {
  /** UTF-8 text. Trimmed of a single trailing newline so visually
   *  identical pastes don't fragment the history. */
  text: string;
  /** epoch ms when this snapshot was first seen. */
  ts: number;
}

export interface ClipboardHistoryOpts {
  /** Polling interval in ms. Defaults to 1500. */
  intervalMs?: number;
  /** Cap on stored entries; oldest fall off when exceeded. Defaults
   *  to 50 — enough for a typical session, not so big the list
   *  becomes unscrollable. */
  maxEntries?: number;
  /** Reject snapshots longer than this many bytes — protects against
   *  accidentally stuffing a giant clipboard contents (a whole
   *  source file etc.) into history. Defaults to 8KB; bypass by
   *  setting to 0. */
  maxBytes?: number;
}

export interface ClipboardHistory {
  /** Snapshot list, newest first. Caller may read but should not
   *  mutate — use `clear` to reset. */
  readonly entries: ReadonlyArray<ClipboardEntry>;
  /** Subscribe to new entries. Returns an unsubscribe function. */
  onChange(fn: () => void): () => void;
  /** Stop polling. Idempotent. */
  stop(): void;
  /** Drop everything. Useful for `/scratch clipboard clear`. */
  clear(): void;
  /** Force one immediate poll — useful after writeClipboard so the
   *  history reflects the just-promoted entry without waiting for
   *  the next tick. */
  pokeNow(): Promise<void>;
}

/** Start polling. No-op on non-clipboard platforms — returns a stub
 *  with empty entries so callers don't need to guard every call. */
export function startClipboardHistory(opts: ClipboardHistoryOpts = {}): ClipboardHistory {
  const intervalMs = opts.intervalMs ?? 1500;
  const maxEntries = opts.maxEntries ?? 50;
  const maxBytes = opts.maxBytes ?? 8 * 1024;

  const entries: ClipboardEntry[] = [];
  const subs = new Set<() => void>();
  let stopped = false;
  let lastSeenText: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  if (!isClipboardSupported()) {
    return {
      entries,
      onChange: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      stop: () => { stopped = true; },
      clear: () => { entries.length = 0; },
      pokeNow: async () => { /* no-op */ },
    };
  }

  const ingest = (raw: string | null): void => {
    if (raw == null) return;
    // Normalise: strip a single trailing newline, drop empty + whitespace-only.
    const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    if (text.trim() === '') return;
    if (maxBytes > 0 && Buffer.byteLength(text, 'utf8') > maxBytes) return;
    if (text === lastSeenText) return;
    lastSeenText = text;
    // De-dup against existing entries by text — re-promotion just
    // bubbles the entry to the front so the user sees it as "most
    // recent" without doubling up.
    const dupIdx = entries.findIndex(e => e.text === text);
    if (dupIdx >= 0) entries.splice(dupIdx, 1);
    entries.unshift({ text, ts: Date.now() });
    while (entries.length > maxEntries) entries.pop();
    for (const fn of subs) { try { fn(); } catch { /* ignore */ } }
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    try { ingest(await readClipboardText()); } catch { /* swallow */ }
  };

  // Kick off immediately so the very first frame already has at
  // least one entry (whatever's currently on the clipboard).
  void poll();
  timer = setInterval(() => { void poll(); }, intervalMs);

  return {
    entries,
    onChange: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    clear: () => { entries.length = 0; lastSeenText = null; },
    pokeNow: async () => { await poll(); },
  };
}
