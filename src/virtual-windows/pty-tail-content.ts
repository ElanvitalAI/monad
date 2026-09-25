// ── PaneContent: pty-tail (V3) ──
//
// Renders a live tail of an already-spawned registry PTY inside a
// VirtualWindow pane. The pane is READ-MOSTLY — it does NOT own the
// PTY's lifecycle (PtyShellStart spawned it; PtyShellKill or the
// auto-kill hook terminates it). We just project snapshot() into a
// scrollable text view and forward typed keys as stdin so a user can
// reach into a running REPL without `PtyShellSend`.
//
// Scope deliberately smaller than preview-terminal.ts (which runs its
// own xterm emulator + node-pty dup-fd plumbing):
//
//   • No xterm grid. The registry already captures raw bytes into
//     a head+tail string buffer — we split that on '\n' and render
//     the tail N lines. ANSI styling passes through because the TUI
//     renderer ships raw bytes to the terminal.
//   • Polls snapshot() every `refreshMs` (default 250 ms). When
//     `event-bus.ts` grows per-handle `pty:output` events in V4, we
//     can swap the timer for a subscription here without touching
//     callers.
//   • j/k scroll the tail-line offset; g/G jump to head/tail.
//     Every other key is forwarded via handle.write() so the LLM and
//     the user can both drive a REPL.
//
// Design ref: DESIGN-background-terminal-port.md §5 V3.

import { C } from '../tui.js';
import { mintPaneId, type PaneId } from './addressing.js';
import type { PaneBroadcast, PaneContent, PaneEventKind, PaneUnsubscribe } from './pane-content.js';
import { getPty, onPtyEvent } from '../pty-shell/registry.js';
import type { PtyHandle } from '../pty-shell/registry.js';

export interface PtyTailPaneSpec {
  kind: 'pty-tail';
  title?: string;
  ptyId: string;
  refreshMs?: number;
}

/** Fallback poll interval for environments that don't hit the event
 *  bus (unit tests mutating snapshot directly, an older registry
 *  variant). When the V4 event bus delivers events, this timer is a
 *  belt-and-braces safety net — it costs ~1 getPty() call per second
 *  so it won't show up in any profile. */
const DEFAULT_REFRESH_MS = 1000;

export function createPtyTailPaneContent(spec: PtyTailPaneSpec): PaneContent {
  const id = mintPaneId();
  const subs = new Map<PaneEventKind, Set<(p?: unknown) => void>>();
  const emit = (ev: PaneEventKind, payload?: unknown) => {
    const s = subs.get(ev);
    if (!s) return;
    for (const cb of s) { try { cb(payload); } catch { /* swallow */ } }
  };
  const on = (ev: PaneEventKind, cb: (payload?: unknown) => void): PaneUnsubscribe => {
    let s = subs.get(ev);
    if (!s) { s = new Set(); subs.set(ev, s); }
    s.add(cb);
    return () => { s!.delete(cb); };
  };

  let scrollOffset = 0;  // lines from the tail; 0 = live tail
  let lastSnapshotLen = 0;
  let exitEmitted = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let busUnsub: (() => void) | null = null;
  let alive = true;

  const pollOnce = () => {
    const h = getPty(spec.ptyId);
    if (!h) {
      if (!exitEmitted) {
        exitEmitted = true;
        emit('exit', null);
      }
      return;
    }
    const snap = h.snapshot();
    if (snap.length !== lastSnapshotLen) {
      lastSnapshotLen = snap.length;
      emit('update');
    }
    if (!h.isAlive() && !exitEmitted) {
      exitEmitted = true;
      emit('exit', h.exitCode);
    }
  };

  const pane: PaneContent = {
    id,
    kind: 'pty-tail',
    title: spec.title ?? `pty:${spec.ptyId}`,
    focusPolicy: 'output-only',
    start(): void {
      if (busUnsub) return;
      // V4: subscribe to registry events so output arrival is push-driven.
      busUnsub = onPtyEvent((ev) => {
        if (ev.type === 'output' && ev.id === spec.ptyId) {
          // Bump the cached size so the fallback poll doesn't also emit.
          const h = getPty(spec.ptyId);
          if (h) lastSnapshotLen = h.snapshot().length;
          emit('update');
          return;
        }
        if (ev.type === 'exit' && ev.id === spec.ptyId && !exitEmitted) {
          exitEmitted = true;
          emit('exit', ev.exitCode);
          return;
        }
        if (ev.type === 'unregistered' && ev.id === spec.ptyId && !exitEmitted) {
          exitEmitted = true;
          emit('exit', null);
          return;
        }
      });
      // Fallback tick so snapshot-only mutations (tests, or a PTY that
      // emits events before the pane subscribed) still reach the UI.
      refreshTimer = setInterval(pollOnce, spec.refreshMs ?? DEFAULT_REFRESH_MS);
      pollOnce();
    },
    stop(): void {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (busUnsub) { busUnsub(); busUnsub = null; }
    },
    render(ctx): string {
      const h = getPty(spec.ptyId);
      if (!h) return renderGone(ctx.cols, ctx.rows, spec.ptyId);
      return renderTail(h, ctx.cols, ctx.rows, scrollOffset);
    },
    onKey(ev) {
      const name = (ev.name ?? '').toLowerCase();
      // j/k: scroll the tail offset. Non-forwarded — user browsing,
      // not typing into the PTY.
      if (!ev.ctrl && !ev.alt && name === 'j') {
        scrollOffset = Math.max(0, scrollOffset - 1);
        emit('update');
        return { type: 'refresh' };
      }
      if (!ev.ctrl && !ev.alt && name === 'k') {
        scrollOffset = scrollOffset + 1;
        emit('update');
        return { type: 'refresh' };
      }
      if (!ev.ctrl && !ev.alt && name === 'g' && !ev.shift) {
        scrollOffset = Number.MAX_SAFE_INTEGER;
        emit('update');
        return { type: 'refresh' };
      }
      if (!ev.ctrl && !ev.alt && (name === 'g' && ev.shift)) {
        scrollOffset = 0;
        emit('update');
        return { type: 'refresh' };
      }
      // Anything else: drop to tail and forward to PTY stdin.
      scrollOffset = 0;
      const h = getPty(spec.ptyId);
      if (!h || !h.isAlive()) return { type: 'none' };
      const bytes = keyToBytes(ev);
      if (!bytes) return { type: 'none' };
      try { h.write(bytes); } catch { /* PTY closing */ }
      return { type: 'refresh' };
    },
    write(bytes): void {
      const h = getPty(spec.ptyId);
      if (!h || !h.isAlive()) return;
      try { h.write(bytes); } catch { /* ignore */ }
    },
    acceptBroadcast(input: PaneBroadcast): void {
      const h = getPty(spec.ptyId);
      if (!h || !h.isAlive()) return;
      try { h.write(input.mode === 'submit' ? terminalSubmitBytes(input.text) : input.text); } catch { /* ignore */ }
    },
    capture(): string {
      const h = getPty(spec.ptyId);
      if (!h) return '';
      return h.snapshot();
    },
    get isAlive(): boolean {
      return alive && (getPty(spec.ptyId)?.isAlive() ?? false);
    },
    on,
    dispose(): void {
      alive = false;
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (busUnsub) { busUnsub(); busUnsub = null; }
      subs.clear();
    },
  };
  return pane;
}

/** Visible render when the PTY has been unregistered (killed + reaped).
 *  Tells the user the pane is stale; they can close it at the window
 *  layer. Single-row content, padded to `rows`. */
function renderGone(cols: number, rows: number, ptyId: string): string {
  const header = C.muted(`(pty ${ptyId} gone)`);
  const lines = [header];
  while (lines.length < rows) lines.push('');
  return lines.slice(0, rows).join('\n');
}

/** Render the last `rows-1` lines of the handle's snapshot, respecting
 *  scroll offset. Line 0 is a muted header with metadata; the
 *  remaining rows are raw snapshot lines (ANSI passthrough). */
export function renderTail(
  handle: Pick<PtyHandle, 'snapshot' | 'id' | 'cmd' | 'isAlive' | 'exitCode' | 'startedAt'>,
  cols: number,
  rows: number,
  scrollOffset: number,
): string {
  const status = handle.isAlive() ? C.accent('● running') : C.muted(`○ exited ${handle.exitCode}`);
  const ageSec = Math.max(0, Math.floor((Date.now() - handle.startedAt) / 1000));
  const age = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m${ageSec % 60}s`;
  const meta = C.muted(age);
  const cmdBudget = Math.max(0, cols - visibleHeaderWidth(`${stripAnsi(status)} ${age}`) - 3);
  const cmd = truncatePlain(handle.cmd.trim(), cmdBudget);
  const header =
    cmd && cols >= 48
      ? `${status} ${meta} ${C.muted('·')} ${C.muted(cmd)}`
      : `${status} ${meta}`;

  const bodyRows = Math.max(1, rows - 1);
  const all = handle.snapshot().split('\n');
  // Drop a trailing empty line that a final '\n' introduces — the grid
  // reads better when the last content line sits on the bottom row.
  if (all.length > 0 && all[all.length - 1] === '') all.pop();

  // Clamp scrollOffset to what's actually scrollable (rows above the
  // visible window). Scrolling past end snaps to the oldest content.
  const maxScroll = Math.max(0, all.length - bodyRows);
  const effScroll = Math.min(Math.max(0, scrollOffset), maxScroll);

  const endIdx = Math.max(bodyRows, all.length - effScroll);
  const startIdx = Math.max(0, endIdx - bodyRows);
  const slice = all.slice(startIdx, endIdx);
  // Pad top when snapshot shorter than viewport so the tail still sits
  // on the bottom row (consistent with preview-terminal's viewport).
  while (slice.length < bodyRows) slice.unshift('');
  return [header, ...slice].slice(0, rows).join('\n');
}

function truncatePlain(text: string, maxWidth: number): string {
  if (!text || maxWidth <= 0) return '';
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return text.slice(0, maxWidth - 1) + '…';
}

function visibleHeaderWidth(text: string): number {
  return stripAnsi(text).length;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Narrow subset of keyEventToTerminalBytes — we don't want to pull
 *  the full execution-surface module into the pty-tail path just for
 *  a handful of keys. Mirrors the critical cases (printable, Enter,
 *  Backspace, arrows, Ctrl+letter). Kept here so the function is
 *  pure-testable without PreviewTerminal plumbing. */
function keyToBytes(ev: { sequence?: string; name?: string; ctrl?: boolean; alt?: boolean; shift?: boolean }): string | null {
  if (ev.sequence) return ev.sequence;
  const name = (ev.name ?? '').toLowerCase();
  if (ev.ctrl && name.length === 1) {
    const code = name.charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  }
  switch (name) {
    case 'enter': case 'return': return '\r';
    case 'tab':       return ev.shift ? '\x1b[Z' : '\t';
    case 'backspace': return '\x7f';
    case 'escape': case 'esc': return '\x1b';
    case 'up':    return '\x1b[A';
    case 'down':  return '\x1b[B';
    case 'right': return '\x1b[C';
    case 'left':  return '\x1b[D';
    case 'home':  return '\x1b[H';
    case 'end':   return '\x1b[F';
    case 'pageup':    return '\x1b[5~';
    case 'pagedown':  return '\x1b[6~';
    case 'delete':    return '\x1b[3~';
    default:
      if (!ev.ctrl && !ev.alt && name.length === 1) return ev.shift ? name.toUpperCase() : name;
      return null;
  }
}

function terminalSubmitBytes(text: string): string {
  return text.endsWith('\n') || text.endsWith('\r') ? text : `${text}\r`;
}
