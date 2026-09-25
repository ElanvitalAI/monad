// ── Terminal slot content (Phase T3b-a) ──
//
// A PaneContent that wraps an EXISTING PreviewTerminal from the
// terminal matrix instead of spawning its own. Enables the
// `{kind:'vw', windowId, slotId}` placement: `matrix.move(id, …)`
// installs the instance's live PTY in a VW slot without respawning.
//
// Why not reuse createTerminalPaneContent?
//   That factory OWNS its PreviewTerminal — starts it, stops it,
//   disposes it. Matrix semantics forbid that: the PTY is authoritative
//   and surfaces are ephemeral. This slot never calls `preview.stop()`;
//   when the slot is removed, we just unwire the render loop.
//
// Why not reuse pty-tail-content?
//   That one pulls snapshots from the pty-shell registry (read-mostly).
//   We need full bidirectional interactivity — every key on the focused
//   slot flows to the PTY, mirroring the interactive-terminal-modal's
//   onKey behavior.

import type {
  PaneBroadcast,
  PaneContent,
  PaneEventKind,
  PaneUnsubscribe,
  PaneRenderCtx,
} from './pane-content.js';
import type { PreviewTerminal } from '../preview/terminal.js';
import { keyEventToTerminalBytes } from '../display/execution-surface.js';
import { mintPaneId } from './addressing.js';
import type { KeyEvent, Action } from '../display/types.js';
import type { GlobalTerminalId, TerminalInstance } from '../terminal-matrix/index.js';

export interface TerminalSlotSpec {
  kind: 'terminal-slot';
  /** The matrix terminal to display in this slot. */
  terminalId: GlobalTerminalId;
  /** Optional display title override. Defaults to instance.title. */
  title?: string;
}

export interface TerminalSlotDeps {
  /** Lookup an instance by id. Factory parameter so tests can inject. */
  resolve: (id: GlobalTerminalId) => TerminalInstance | undefined;
}

export function createTerminalSlotContent(
  spec: TerminalSlotSpec,
  deps: TerminalSlotDeps,
): PaneContent {
  const id = mintPaneId();
  const subs = new Map<PaneEventKind, Set<(p?: unknown) => void>>();

  const instance = deps.resolve(spec.terminalId);
  if (!instance) {
    // Return a disposed-placeholder pane. Caller should check
    // `isAlive` right after construction; in practice the adapter
    // below never calls this factory for a missing instance.
    return makeMissingPane(id, spec.terminalId, subs);
  }

  const preview: PreviewTerminal = instance.pty;

  const emit = (ev: PaneEventKind, payload?: unknown): void => {
    const s = subs.get(ev);
    if (!s) return;
    for (const cb of s) { try { cb(payload); } catch { /* swallow */ } }
  };

  // Subscribe to matrix events for this instance so we can signal
  // 'exit' when the PTY dies or the instance is killed. The matrix
  // already subscribes to the underlying sessionRegistry — we just
  // observe via its bus.
  // (Subscription lives on the matrix module; we avoid importing the
  // singleton here to keep this file test-friendly. Callers that
  // want the exit hook register it directly on matrix.subscribe.)

  return {
    id,
    kind: 'terminal-slot',
    focusPolicy: 'interactive',
    get title() { return spec.title ?? instance.title; },
    start() { /* PTY already running — nothing to do */ },
    stop() { /* PTY lifecycle owned by matrix; no-op */ },
    render(ctx: PaneRenderCtx): string {
      // Resize the emulator to the pane's current dimensions. The
      // PreviewTerminal tolerates duplicate resizes so we don't need
      // a per-frame dim cache here.
      try { preview.resize(Math.max(2, ctx.cols), Math.max(2, ctx.rows)); }
      catch { /* ignore — sizes mismatch during teardown */ }
      try { return preview.render(ctx.focused); }
      catch { return ''; }
    },
    onKey(ev: KeyEvent): Action {
      // Read-only enforcement is handled at the matrix level (pty.write
      // guard in T7b), so we can forward bytes unconditionally here.
      const bytes = keyEventToTerminalBytes(ev);
      if (!bytes) return { type: 'none' };
      try { preview.write(bytes); } catch { /* ignore */ }
      return { type: 'refresh' };
    },
    write(bytes: string) {
      try { preview.write(bytes); } catch { /* ignore */ }
    },
    acceptBroadcast(input: PaneBroadcast) {
      try {
        preview.write(input.mode === 'submit' ? terminalSubmitBytes(input.text) : input.text);
      } catch { /* ignore */ }
    },
    capture(): string {
      try { return preview.render(false); } catch { return ''; }
    },
    get isAlive(): boolean {
      return preview.isAlive && instance.exitCode === null;
    },
    on(event: PaneEventKind, cb: (payload?: unknown) => void): PaneUnsubscribe {
      let s = subs.get(event);
      if (!s) { s = new Set(); subs.set(event, s); }
      s.add(cb);
      return () => { s!.delete(cb); };
    },
    dispose() {
      // Slot removal doesn't kill the PTY — matrix retains it.
      subs.clear();
      emit('exit');
    },
  };
}

function makeMissingPane(
  id: ReturnType<typeof mintPaneId>,
  terminalId: GlobalTerminalId,
  subs: Map<PaneEventKind, Set<(p?: unknown) => void>>,
): PaneContent {
  const body = `(terminal ${terminalId} not found in matrix)`;
  return {
    id,
    kind: 'terminal-slot',
    title: `missing:${terminalId}`,
    focusPolicy: 'output-only',
    start() {},
    stop() {},
    render: (ctx) => padToRows(body, ctx.rows),
    onKey: () => ({ type: 'none' }),
    write() {},
    capture: () => body,
    get isAlive() { return false; },
    on(event, cb) {
      let s = subs.get(event);
      if (!s) { s = new Set(); subs.set(event, s); }
      s.add(cb);
      return () => { s!.delete(cb); };
    },
    dispose() { subs.clear(); },
  };
}

function padToRows(text: string, rows: number): string {
  const lines = text.split('\n');
  while (lines.length < rows) lines.push('');
  return lines.slice(0, rows).join('\n');
}

function terminalSubmitBytes(text: string): string {
  return text.endsWith('\n') || text.endsWith('\r') ? text : `${text}\r`;
}
