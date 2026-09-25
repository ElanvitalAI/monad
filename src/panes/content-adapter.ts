// ── VW-term-infra W1 — PaneContentAdapter ──
//
// Bridges the existing `PaneContent` (src/virtual-windows/pane-content.ts)
// to the new substrate `Pane` interface. The scope of W1 was re-defined
// per LESSONS L1: pane-content.ts already uses a factory pattern, so
// the substrate does NOT need to replace it. Instead, this adapter
// lets new Pane consumers (capture engine, CaptureController,
// DescribePane LLM tool, etc.) access legacy PaneContent instances
// through the unified Pane API without requiring VW rewrites.
//
// Behavior
//   - describe(): pulls title + kind from PaneContent.
//   - snapshot(): wraps PaneContent.capture() (text-only) into
//     a PaneSnapshot with format='text'.
//   - addTap('event'): forwards PaneContent.on('update'|'exit')
//     as PaneEvent. Frame / raw taps are NotSupported since
//     PaneContent doesn't expose byte-level streams uniformly.
//   - render(): delegates click regions; actual ANSI paint stays
//     with the VW composer (host code already knows how to render
//     each PaneContentKind).
//
// See: 내부 문서 `PLAN-session-vw-term-infra-wiring` §6 (W1)
//      내부 문서 `LESSONS-session-vw-term-infra-p0-p2` L1

import { debug } from '../debug/log.js';
import type { Rect } from '../display/rect.js';
import type { PaneContent, PaneContentKind } from '../virtual-windows/pane-content.js';
import { AbstractPane } from './base.js';
import { type PaneSnapshot, type SnapshotOpts } from './snapshot.js';
import {
  PaneTapNotSupportedError,
  type PaneEvent,
  type TapCallback,
  type TapKind,
  type Unsubscribe,
} from './tap.js';
import type { ClickRegion, PaneKind, PaneRef, TapOptions } from './types.js';

/** Wraps an existing PaneContent instance behind the Pane contract. */
export class PaneContentAdapter extends AbstractPane {
  constructor(
    ref: PaneRef,
    private readonly content: PaneContent,
  ) {
    super(ref);
  }

  get kind(): PaneKind {
    return inferKindFromContent(this.content);
  }

  render(bounds: Rect): readonly ClickRegion[] {
    this.lastBounds = bounds;
    // The VW composer paints the real ANSI grid using the legacy
    // PaneContent.render(ctx) pipeline — this adapter doesn't try to
    // reproduce that. We publish a single full-bounds click region
    // tagged with the underlying content kind so HitTarget / capture
    // overlay can route hovers correctly.
    return [
      {
        id: `${this.ref.paneId}:content:${this.content.kind}`,
        rect: bounds,
        kind: this.content.kind,
      },
    ];
  }

  protected describeTitle(): string {
    return this.content.title;
  }

  protected describeSummary(): string {
    return `content pane · ${this.content.kind} · ${this.content.isAlive ? 'alive' : 'stopped'}`;
  }

  protected supportedTaps(): readonly TapKind[] {
    return ['event'];
  }

  async snapshot(_opts?: SnapshotOpts): Promise<PaneSnapshot> {
    const dims = this.lastBounds ?? { row: 0, col: 0, width: 0, height: 0 };
    let text = '';
    try {
      text = this.content.capture();
    } catch (err) {
      if (debug.enabled) {
        debug.log('pane.snapshot.error', `${this.ref.paneId}`, {
          err: String(err), adapter: 'content',
        }, { level: 'error' });
      }
    }
    return {
      ref: this.ref,
      kind: this.kind,
      capturedAt: Date.now(),
      dims,
      text,
      meta: {
        title: this.content.title,
      },
    };
  }

  addTap(kind: TapKind, cb: TapCallback, _opts?: TapOptions): Unsubscribe {
    if (kind === 'event') {
      const offUpdate = this.content.on('update', () => {
        const evt: PaneEvent = {
          kind: 'widget-state',
          fingerprint: String(Date.now()),
        };
        try { (cb as (e: PaneEvent) => void)(evt); } catch { /* isolate */ }
      });
      const offExit = this.content.on('exit', (payload) => {
        const code = typeof payload === 'number' ? payload : null;
        const evt: PaneEvent = { kind: 'exit', code };
        try { (cb as (e: PaneEvent) => void)(evt); } catch { /* isolate */ }
      });
      if (debug.enabled) {
        debug.log('pane.tap.event.start', `${this.ref.paneId}`, {
          adapter: 'content', contentKind: this.content.kind,
        });
      }
      return () => {
        offUpdate();
        offExit();
        if (debug.enabled) {
          debug.log('pane.tap.event.stop', `${this.ref.paneId}`, { adapter: 'content' });
        }
      };
    }

    // Raw / frame taps are NotSupported — PaneContent instances don't
    // expose byte streams uniformly. Consumers that need byte-level
    // observation should use TerminalPane / ExternalTerminalPane
    // directly (via PaneFactory kind discrimination) instead of this
    // adapter.
    throw new PaneTapNotSupportedError(kind, this.ref.paneId);
  }
}

/** Map a PaneContentKind to the substrate's PaneKind discriminated
 *  union. `terminal`, `terminal-slot`, `pty-tail` all map to the
 *  substrate's 'terminal' kind; everything else collapses to 'widget'
 *  (since markdown / scratch / llm-chat behave like widgets — pure
 *  render + event emit, no PTY fd). */
export function inferKindFromContent(c: PaneContent): PaneKind {
  switch (c.kind as PaneContentKind) {
    case 'terminal':
    case 'terminal-slot':
    case 'pty-tail':
      return { kind: 'terminal', terminalId: c.id };
    case 'markdown':
    case 'scratch':
    case 'llm-chat':
    default:
      return {
        kind: 'widget',
        widgetId: c.id,
        widgetClass: String(c.kind),
      };
  }
}
