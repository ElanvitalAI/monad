// WT-S-3 — WebTerminalPane.
//
// Wraps a PWA-spawned PreviewTerminal as a Pane so the rest of the
// pane substrate (capture engine, ObserveSurface / DescribeSurface /
// ComparePanes / WatchPane LLM tools, snapshot serialisation) sees
// web terminals through the same contract as dashboard TerminalPanes.
//
// Design — wrap PreviewTerminal directly rather than constructing a
// synthetic TerminalInstance:
//   - PreviewTerminal already provides render() / addRawOutputTap()
//     / addEventTap() / cursorPosition() — exactly what TerminalPane
//     delegates to under the hood.
//   - TerminalInstance has placement/character/transport/broadcastGroups
//     fields that don't apply to web terminals (no VW placement, no
//     dashboard character routing). Synthesising those fields would
//     leak fake values into matrix-aware code.
//   - Cross-track: avoids touching `src/terminal-matrix/` (capture-team
//     canonical) — additive only in `src/panes/`.
//
// PaneRef convention: `{windowId: 'web', paneId: 'webterm-<terminalId>'}`.
// The 'web' sentinel windowId tells dashboard layout code "not a real
// window slot, route via factory only" — capture lookup + LLM tools
// reach the pane via factory.peek({windowId:'web', paneId:'webterm-<id>'}).

import { debug } from '../debug/log.js';
import type { Rect } from '../display/rect.js';
import type { PreviewTerminal, TerminalEvent } from '../preview/terminal.js';
import { AbstractPane } from './base.js';
import { emptySnapshot, type PaneSnapshot, type SnapshotOpts } from './snapshot.js';
import {
  PaneTapNotSupportedError,
  type FrameChunk,
  type PaneEvent,
  type RawChunk,
  type TapCallback,
  type TapKind,
  type Unsubscribe,
} from './tap.js';
import type { ClickRegion, PaneKind, PaneRef, TapOptions } from './types.js';

export interface WebTerminalPaneOpts {
  /** preview-tap-registry key — same value used by `terminal/spawn` ACP
   *  ext method. Embedded in the kind discriminator so capture/LLM
   *  consumers can route back to the registry without unwrapping the
   *  pane. */
  readonly sessionId: string;
  readonly terminalId: string;
  /** PreviewTerminal instance from preview-tap-registry. The pane
   *  doesn't own the lifecycle — caller (typically the registry)
   *  drops the pane (`factory.invalidate(ref)`) when the underlying
   *  PreviewTerminal exits. */
  readonly pty: PreviewTerminal;
  /** Optional title — defaults to `webterm-<terminalId>`. */
  readonly title?: string;
}

export class WebTerminalPane extends AbstractPane {
  private readonly pty: PreviewTerminal;
  private readonly sessionId: string;
  private readonly terminalId: string;
  private readonly _title: string;

  constructor(ref: PaneRef, opts: WebTerminalPaneOpts) {
    super(ref);
    this.pty = opts.pty;
    this.sessionId = opts.sessionId;
    this.terminalId = opts.terminalId;
    this._title = opts.title ?? `webterm-${opts.terminalId}`;
  }

  get kind(): PaneKind {
    return { kind: 'web-terminal', sessionId: this.sessionId, terminalId: this.terminalId };
  }

  render(bounds: Rect): readonly ClickRegion[] {
    this.lastBounds = bounds;
    // Web-terminal panes don't get drawn by the dashboard host (the
    // PWA xterm.js renders client-side). The ClickRegion is reported
    // for symmetry — capture / mouse-aware tools see the same shape
    // as a regular TerminalPane.
    return [
      { id: `${this.ref.paneId}:web-terminal:${this.terminalId}`, rect: bounds, kind: 'terminal' },
    ];
  }

  protected describeTitle(): string {
    return this._title;
  }

  protected describeSummary(): string {
    return `web-terminal ${this.terminalId} · session ${this.sessionId.slice(0, 8)}`;
  }

  protected supportedTaps(): readonly TapKind[] {
    return ['raw', 'frame', 'event'];
  }

  async snapshot(opts?: SnapshotOpts): Promise<PaneSnapshot> {
    const dims = this.lastBounds ?? { row: 0, col: 0, width: this.pty.cols, height: this.pty.rows };
    if (opts?.format === 'text' || opts?.format === 'ansi') {
      try {
        const ansi = this.pty.render(false);
        return {
          ref: this.ref,
          kind: this.kind,
          capturedAt: Date.now(),
          dims,
          ansi: opts.format === 'ansi' ? ansi : undefined,
          text: opts.format === 'text' ? stripEscapes(ansi) : undefined,
          meta: {
            cursor: this.pty.cursorPosition() ?? undefined,
            title: this._title,
          },
        };
      } catch (err) {
        if (debug.enabled) debug.log('pane.snapshot.error', `${this.ref.paneId}`, { err: String(err) }, { level: 'error' });
      }
    }
    return emptySnapshot(this.ref, this.kind, dims);
  }

  addTap(kind: TapKind, cb: TapCallback, opts?: TapOptions): Unsubscribe {
    if (kind === 'raw') {
      return this.pty.addRawOutputTap((chunk: string) => {
        const raw: RawChunk = { bytes: chunk, ts: Date.now() };
        try { (cb as (c: RawChunk) => void)(raw); } catch { /* isolate */ }
      });
    }

    if (kind === 'frame') {
      const throttleMs = Math.max(16, opts?.throttleMs ?? 100);
      let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (!this.mounted) return;
        let ansi: string;
        try {
          ansi = this.pty.render(false);
        } catch (err) {
          if (debug.enabled) {
            debug.log('pane.tap.frame.error', `${this.ref.paneId}`, { err: String(err) }, { level: 'error' });
          }
          return;
        }
        const dims = this.lastBounds ?? {
          row: 0, col: 0,
          width: this.pty.cols,
          height: this.pty.rows,
        };
        const frame: FrameChunk = {
          mime: 'text/ansi',
          bytes: ansi,
          dims,
          ts: Date.now(),
        };
        try { (cb as (f: FrameChunk) => void)(frame); } catch { /* isolate */ }
      }, throttleMs);
      if (debug.enabled) {
        debug.log('pane.tap.frame.start', `${this.ref.paneId}`, { throttleMs });
      }
      return () => {
        if (timer) { clearInterval(timer); timer = null; }
        if (debug.enabled) {
          debug.log('pane.tap.frame.stop', `${this.ref.paneId}`, {});
        }
      };
    }

    if (kind === 'event') {
      const offEvent = this.pty.addEventTap((ev: TerminalEvent) => {
        let pev: PaneEvent;
        if (ev.kind === 'cursor') {
          pev = { kind: 'cursor', row: ev.row, col: ev.col };
        } else if (ev.kind === 'resize') {
          const dims = this.lastBounds ?? {
            row: 0, col: 0, width: ev.cols, height: ev.rows,
          };
          pev = {
            kind: 'resize',
            dims: { row: dims.row, col: dims.col, width: ev.cols, height: ev.rows },
          };
        } else {
          pev = { kind: 'title', title: ev.title };
        }
        try { (cb as (e: PaneEvent) => void)(pev); } catch { /* isolate */ }
      });
      if (debug.enabled) {
        debug.log('pane.tap.event.start', `${this.ref.paneId}`, {
          throttleMs: opts?.throttleMs ?? null,
        });
      }
      return () => {
        offEvent();
        if (debug.enabled) {
          debug.log('pane.tap.event.stop', `${this.ref.paneId}`, {});
        }
      };
    }

    throw new PaneTapNotSupportedError(kind, this.ref.paneId);
  }
}

function stripEscapes(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/** Convention helper: build the PaneRef for a web-terminal so callers
 *  outside `src/web-terminal/` don't have to remember the 'web'
 *  sentinel windowId. */
export function webTerminalPaneRef(terminalId: string): PaneRef {
  return { windowId: 'web', paneId: `webterm-${terminalId}` };
}
