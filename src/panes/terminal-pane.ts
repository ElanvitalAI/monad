// ── VW-term-infra Phase 1/2 — TerminalPane ──
//
// Wraps a TerminalMatrix TerminalInstance as a Pane.
//
// W3 (wiring sprint) landed frame tap: setInterval + PreviewTerminal.render
// → FrameChunk emit. Event tap is still NotSupported pending PreviewTerminal
// lifecycle event forwarding API (W3-ext). Raw tap delegates to the
// existing addRawOutputTap primitive.

import { debug } from '../debug/log.js';
import type { Rect } from '../display/rect.js';
import type { TerminalEvent } from '../preview/terminal.js';
import type { TerminalInstance } from '../terminal-matrix/types.js';
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

export class TerminalPane extends AbstractPane {
  constructor(ref: PaneRef, private readonly term: TerminalInstance) {
    super(ref);
  }

  get kind(): PaneKind {
    return { kind: 'terminal', terminalId: this.term.id };
  }

  render(bounds: Rect): readonly ClickRegion[] {
    this.lastBounds = bounds;
    // Actual drawing stays with the host composer during Phase 1 —
    // it already knows how to render a TerminalInstance via the
    // existing VW pane pipeline. TerminalPane's job at this stage
    // is to be a Pane-typed handle so describe() / snapshot() /
    // addTap() work uniformly.
    return [
      { id: `${this.ref.paneId}:terminal:${this.term.id}`, rect: bounds, kind: 'terminal' },
    ];
  }

  protected describeTitle(): string {
    return this.term.title;
  }

  protected describeSummary(): string {
    const placement = this.term.placement.kind;
    const transport = this.term.transport.kind;
    return `terminal ${this.term.id} · ${placement} · ${transport} · ${this.term.character.kind}`;
  }

  protected supportedTaps(): readonly TapKind[] {
    return ['raw', 'frame', 'event'];
  }

  async snapshot(opts?: SnapshotOpts): Promise<PaneSnapshot> {
    // Phase 2b will replace this with a cells-grid extraction from
    // the xterm buffer; for Phase 1 we return an ANSI-format snapshot
    // via the existing render() — it's lossy but non-empty and
    // exercises the contract for capture tests.
    const dims = this.lastBounds ?? { row: 0, col: 0, width: this.term.pty.cols, height: this.term.pty.rows };
    if (opts?.format === 'text' || opts?.format === 'ansi') {
      try {
        const ansi = this.term.pty.render(false);
        return {
          ref: this.ref,
          kind: this.kind,
          capturedAt: Date.now(),
          dims,
          ansi: opts.format === 'ansi' ? ansi : undefined,
          text: opts.format === 'text' ? stripEscapes(ansi) : undefined,
          meta: {
            cursor: this.term.pty.cursorPosition() ?? undefined,
            title: this.term.title,
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
      const tap = this.term.pty.addRawOutputTap((chunk: string) => {
        const raw: RawChunk = { bytes: chunk, ts: Date.now() };
        try { (cb as (c: RawChunk) => void)(raw); } catch { /* isolate */ }
      });
      return tap;
    }

    if (kind === 'frame') {
      const throttleMs = Math.max(16, opts?.throttleMs ?? 100);
      let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (!this.mounted) return;
        let ansi: string;
        try {
          ansi = this.term.pty.render(false);
        } catch (err) {
          if (debug.enabled) {
            debug.log('pane.tap.frame.error', `${this.ref.paneId}`, { err: String(err) }, { level: 'error' });
          }
          return;
        }
        const dims = this.lastBounds ?? {
          row: 0, col: 0,
          width: this.term.pty.cols,
          height: this.term.pty.rows,
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
      // W3-ext — fan out PreviewTerminal's cursor/resize/title
      // subscription into the pane-substrate PaneEvent vocabulary.
      // Payload shapes stay 1:1 with the emulator emitters; the host
      // consumer (capture engine, LLM tools) decides how to dedupe.
      const offEvent = this.term.pty.addEventTap((ev: TerminalEvent) => {
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
  // Minimal SGR + CSI strip — full implementation lives in preview-terminal
  // stripMotionSequences, but the stub here avoids the wider import graph.
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
