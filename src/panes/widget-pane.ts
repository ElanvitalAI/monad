// ── VW-term-infra Phase 1 — WidgetPane ──
//
// Wraps a WidgetInstance (from src/widget-types.ts · Phase 1 widget-arch
// refactor) as a Pane. Phase 1 scope: stub with TODO wiring — the
// class compiles and describes itself, but the full render + state
// subscription path stays with the existing WidgetHost during this
// phase. Phase 2a adds frame / event taps; Phase 2b fills snapshot
// with a cell-grid extract from Widget.render().

import { debug } from '../debug/log.js';
import type { Rect } from '../display/rect.js';
import type { Widget, WidgetInstance } from '../widgets/types.js';
import { AbstractPane } from './base.js';
import {
  PaneTapNotSupportedError,
  type PaneEvent,
  type TapCallback,
  type TapKind,
  type Unsubscribe,
} from './tap.js';
import type { ClickRegion, PaneKind, PaneRef, TapOptions } from './types.js';

export class WidgetPane extends AbstractPane {
  constructor(
    ref: PaneRef,
    private readonly instance: WidgetInstance,
    private readonly def: Widget,
  ) {
    super(ref);
  }

  get kind(): PaneKind {
    return {
      kind: 'widget',
      widgetId: this.instance.id,
      widgetClass: this.instance.type,
    };
  }

  render(bounds: Rect): readonly ClickRegion[] {
    this.lastBounds = bounds;
    return [
      { id: `${this.ref.paneId}:widget:${this.instance.id}`, rect: bounds, kind: 'widget' },
    ];
  }

  protected describeTitle(): string {
    return this.instance.character || this.def.type;
  }

  protected describeSummary(): string {
    return `widget ${this.instance.type} (${this.instance.id}) — ${this.def.description}`;
  }

  protected supportedTaps(): readonly TapKind[] {
    // Event tap via state fingerprint diff (W3). Frame tap deferred
    // to when WidgetHost exposes a render-emit hook (Widget Arch
    // Phase 4 LLM control) — no precise frame can be produced today
    // without a synchronous reentrant render path. Raw tap is N/A
    // for widget panes (no PTY-style byte stream).
    return ['event'];
  }

  addTap(kind: TapKind, cb: TapCallback, opts?: TapOptions): Unsubscribe {
    if (kind === 'event') {
      const throttleMs = Math.max(32, opts?.throttleMs ?? 200);
      let lastFingerprint: string | null = null;
      const fingerprint = (): string => {
        try { return JSON.stringify(this.instance.state); }
        catch { return String(this.instance.state ?? ''); }
      };
      let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
        const fp = fingerprint();
        if (fp !== lastFingerprint) {
          lastFingerprint = fp;
          const evt: PaneEvent = { kind: 'widget-state', fingerprint: fp };
          try { (cb as (e: PaneEvent) => void)(evt); } catch { /* isolate */ }
        }
      }, throttleMs);
      if (debug.enabled) {
        debug.log('pane.tap.event.start', `${this.ref.paneId}`, {
          kind: 'widget', throttleMs,
        });
      }
      return () => {
        if (timer) { clearInterval(timer); timer = null; }
        if (debug.enabled) {
          debug.log('pane.tap.event.stop', `${this.ref.paneId}`, {});
        }
      };
    }
    throw new PaneTapNotSupportedError(kind, this.ref.paneId);
  }
}
