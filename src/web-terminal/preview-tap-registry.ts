// WT-S-1 — PreviewTerminal ↔ ACP fan-out registry.
//
// Bridges the existing `PreviewTerminal.addRawOutputTap()` (T7c1) to
// the ACP `terminalOutput()` broadcast on a daemon-bound
// `AcpServerHandle`. Read-only direction: daemon stdout → web peers.
//
// Why a registry instead of wiring inline at the dashboard?
//   1. PreviewTerminal instances live in the dashboard layer; the
//      AcpServerHandle is bound on the daemon-public-server boot path.
//      The two converge here without either side knowing about the
//      other.
//   2. WT-S-2 will replace the direct `addRawOutputTap` hook with
//      PaneFactory's `addTap('raw', ...)` — keeping the handoff in one
//      file lets that swap stay surgical.
//
// Lifecycle: register at PreviewTerminal construction, unregister at
// stop. Re-register replaces the prior entry (idempotent). The
// returned thunk unsubscribes; callers may also call
// `unregisterPreviewTerminalForWebTap` directly.

import type { PreviewTerminal } from '../preview/terminal.js';
import type { AcpServerHandle } from '../acp/server.js';
import { debug } from '../debug/log.js';
import { getDefaultPaneFactory } from '../panes/factory.js';
import { webTerminalPaneRef } from '../panes/web-terminal-pane.js';

interface Entry {
  sessionId: string;
  terminalId: string;
  unsubscribe: () => void;
  /** WT-S-3 — set when the web-terminal was successfully resolved
   *  through the PaneFactory. Cleared on unregister so capture engine
   *  / LLM tools don't see a stale pane after the PTY exits. */
  paneResolved: boolean;
  /** 최초 등록 시각(ms). 재등록 뒤에도 정렬 기준을 안정적으로 유지한다. */
  firstRegisteredAt: number;
  /** P4(2026-07-12) — 마지막 PTY 출력 시각(ms). output tap 에서 갱신 —
   *  터미널 탭 "최근 활동" 표면용. 등록 시각으로 초기화. */
  lastOutputAt: number;
}

const entries = new Map<PreviewTerminal, Entry>();

/** Subscribe to `pt`'s raw stdout taps and forward each chunk to the
 *  daemon's `AcpServerHandle.terminalOutput()`. Idempotent —
 *  re-registering replaces the previous tap. Returns a thunk that
 *  unregisters; the same effect as `unregisterPreviewTerminalForWebTap(pt)`. */
export function registerPreviewTerminalForWebTap(
  pt: PreviewTerminal,
  sessionId: string,
  terminalId: string,
  handle: AcpServerHandle,
): () => void {
  const firstRegisteredAt = entries.get(pt)?.firstRegisteredAt;
  unregisterPreviewTerminalForWebTap(pt);
  const off = pt.addRawOutputTap((chunk) => {
    if (debug.enabled) {
      debug.log('webterm.tap', 'chunk', {
        terminalId,
        bytes: chunk.length,
      });
    }
    const e = entries.get(pt);
    if (e) e.lastOutputAt = Date.now();
    void handle.terminalOutput(sessionId, terminalId, chunk);
  });
  // WT-S-3 — register through PaneFactory so capture engine /
  // ObserveSurface / DescribeSurface / Compare/WatchPane / Snapshot
  // tools all see the web-terminal as a first-class Pane. Best-effort:
  // factory may not be initialised in headless test contexts.
  let paneResolved = false;
  try {
    const factory = getDefaultPaneFactory();
    factory.resolveFromWebTerminal(webTerminalPaneRef(terminalId), {
      sessionId, terminalId, pty: pt,
    });
    paneResolved = true;
    if (debug.enabled) {
      debug.log('webterm.tap', 'pane.resolved', { sessionId, terminalId });
    }
  } catch (err) {
    if (debug.enabled) {
      debug.log('webterm.tap', 'pane.resolve-skip', {
        sessionId, terminalId, reason: String(err instanceof Error ? err.message : err),
      });
    }
  }
  const registeredAt = firstRegisteredAt ?? Date.now();
  entries.set(pt, {
    sessionId,
    terminalId,
    unsubscribe: off,
    paneResolved,
    firstRegisteredAt: registeredAt,
    lastOutputAt: registeredAt,
  });
  if (debug.enabled) {
    debug.log('webterm.tap', 'register', { sessionId, terminalId, paneResolved });
  }
  return () => unregisterPreviewTerminalForWebTap(pt);
}

/** Drop the tap subscription for `pt`. No-op when `pt` was not
 *  previously registered. WT-S-3 also invalidates the PaneFactory
 *  entry so capture engine + LLM tools stop seeing the dead web-term. */
export function unregisterPreviewTerminalForWebTap(pt: PreviewTerminal): void {
  const e = entries.get(pt);
  if (!e) return;
  e.unsubscribe();
  if (e.paneResolved) {
    try {
      getDefaultPaneFactory().invalidate(webTerminalPaneRef(e.terminalId));
    } catch { /* swallow — factory may have already reset (test teardown) */ }
  }
  entries.delete(pt);
  if (debug.enabled) {
    debug.log('webterm.tap', 'unregister', {
      sessionId: e.sessionId,
      terminalId: e.terminalId,
      paneInvalidated: e.paneResolved,
    });
  }
}

/** Test/diagnostic — number of currently registered PreviewTerminals. */
export function getRegisteredPreviewTerminalCount(): number {
  return entries.size;
}

/** WT-A-1 — reverse lookup. Returns the registered PreviewTerminal
 *  whose (sessionId, terminalId) matches, or null. Used by the daemon
 *  ACP `terminal/input` / `terminal/resize` handlers to route incoming
 *  PWA writes to the right PTY. */
export function lookupPreviewTerminal(
  sessionId: string,
  terminalId: string,
): import('../preview/terminal.js').PreviewTerminal | null {
  for (const [pt, e] of entries) {
    if (e.sessionId === sessionId && e.terminalId === terminalId) return pt;
  }
  return null;
}

/** WT-S-2 — public-facing list entry shape returned by the
 *  `terminal/list` ACP ext method. Kept narrow on purpose: pid + dims +
 *  alive flag are the only fields the PWA TabsBar needs to render
 *  per-terminal status. Add fields conservatively (each becomes part of
 *  the wire contract). */
export interface PreviewTerminalListEntry {
  /** Owning ACP session; identifies same-named terminals across sessions. */
  sessionId: string;
  terminalId: string;
  pid: number;
  cols: number;
  rows: number;
  isAlive: boolean;
  /** 최초 등록 시각(epoch ms). 재등록 중에도 유지되는 터미널 시작 시각. */
  firstRegisteredAt: number;
  /** P4 — 마지막 PTY 출력 시각(epoch ms). 탭 "최근 활동" 표면용. */
  lastOutputAt: number;
}

function toPreviewTerminalListEntry(
  pt: PreviewTerminal,
  entry: Entry,
): PreviewTerminalListEntry {
  return {
    sessionId: entry.sessionId,
    terminalId: entry.terminalId,
    pid: pt.pid,
    cols: pt.cols,
    rows: pt.rows,
    isAlive: pt.isAlive,
    firstRegisteredAt: entry.firstRegisteredAt,
    lastOutputAt: entry.lastOutputAt,
  };
}

/** Enumerate every active terminal in the global registry. */
export function listAllPreviewTerminals(): PreviewTerminalListEntry[] {
  return Array.from(entries, ([pt, entry]) => toPreviewTerminalListEntry(pt, entry));
}

/** WT-S-2 — enumerate active terminals for `sessionId`. Used by the
 *  daemon `terminal/list` extMethod handler. Linear scan over the
 *  global registry — fine for the expected ≤10 terminals per session;
 *  if that scales out, partition `entries` by sessionId here without
 *  touching the call sites. */
export function listPreviewTerminals(sessionId: string): PreviewTerminalListEntry[] {
  return listAllPreviewTerminals().filter((entry) => entry.sessionId === sessionId);
}

/** Test-only — wipe all entries. Production callers should use
 *  `unregisterPreviewTerminalForWebTap` per terminal. */
export function __resetPreviewTapRegistry(): void {
  for (const e of entries.values()) e.unsubscribe();
  entries.clear();
}
