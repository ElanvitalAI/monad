// ── VW-term-infra Phase 1 — AbstractPane base class ──
//
// Shared lifecycle / description scaffold for concrete pane kinds.
// Subclasses (TerminalPane · ExternalTerminalPane · WidgetPane ·
// PlaceholderPane) supply the behavior-specific pieces; this class
// handles the common mount/unmount bookkeeping, the no-op defaults,
// and the describe() shape that non-overridden kinds need.
//
// Subclasses MUST override:
//   - `kind` getter
//   - `render(bounds)`
//
// Subclasses SHOULD override as appropriate:
//   - `onKey`, `onMouse` (default = passthrough)
//   - `describe()` to fill in title + summary
//   - `snapshot()` (default = empty snapshot — fine for placeholder
//     only; every other kind must produce real content)
//   - `addTap()` (default throws PaneTapNotSupportedError)

import { debug } from '../debug/log.js';
import type { Rect } from '../display/rect.js';
import { emptySnapshot, type PaneSnapshot, type SnapshotOpts } from './snapshot.js';
import { PaneTapNotSupportedError, type TapCallback, type TapKind, type Unsubscribe } from './tap.js';
import type {
  ChordHint,
  ClickRegion,
  Pane,
  PaneContext,
  PaneDescription,
  PaneDispatchResult,
  PaneKeyEvent,
  PaneKind,
  PaneMouseEvent,
  PaneRef,
  TapOptions,
  ToolHint,
} from './types.js';

export abstract class AbstractPane implements Pane {
  private readonly onUnmountCbs: Array<() => void> = [];
  protected mounted = false;
  protected lastBounds: Rect | null = null;

  constructor(public readonly ref: PaneRef) {}

  abstract get kind(): PaneKind;

  abstract render(bounds: Rect): readonly ClickRegion[];

  // ── Default interaction handlers — subclasses override as needed.

  onKey(_evt: PaneKeyEvent): PaneDispatchResult | Promise<PaneDispatchResult> {
    return 'passthrough';
  }

  onMouse(_evt: PaneMouseEvent): PaneDispatchResult | Promise<PaneDispatchResult> {
    return 'passthrough';
  }

  // ── Description default — subclasses should override title/summary.

  protected supportedTaps(): readonly TapKind[] { return []; }
  protected chords(): readonly ChordHint[] { return []; }
  protected tools(): readonly ToolHint[] { return []; }

  describe(): PaneDescription {
    return {
      ref: this.ref,
      kind: this.kind,
      title: this.describeTitle(),
      summary: this.describeSummary(),
      supportedTaps: this.supportedTaps(),
      chords: this.chords(),
      tools: this.tools(),
    };
  }

  protected describeTitle(): string { return this.ref.paneId; }
  protected describeSummary(): string { return `${this.kind.kind} pane`; }

  // ── Snapshot default — placeholder-style empty payload. Subclasses
  //    that own real content (terminal · widget) must override.

  async snapshot(_opts?: SnapshotOpts): Promise<PaneSnapshot> {
    const dims = this.lastBounds ?? { row: 0, col: 0, width: 0, height: 0 };
    return emptySnapshot(this.ref, this.kind, dims);
  }

  // ── Tap default — NotSupported unless overridden.

  addTap(kind: TapKind, _cb: TapCallback, _opts?: TapOptions): Unsubscribe {
    throw new PaneTapNotSupportedError(kind, this.ref.paneId);
  }

  // ── Lifecycle — mount / unmount are idempotent and ring debug.log.

  mount(ctx: PaneContext): void {
    if (this.mounted) return;
    this.mounted = true;
    this.lastBounds = ctx.bounds;
    ctx.onUnmount(() => this.unmount());
    if (debug.enabled) {
      debug.log('pane.mount', `${this.ref.paneId}`, {
        kind: this.kind.kind,
        bounds: ctx.bounds,
      });
    }
    this.onMount(ctx);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (debug.enabled) {
      debug.log('pane.unmount', `${this.ref.paneId}`, { kind: this.kind.kind });
    }
    for (const cb of this.onUnmountCbs.splice(0)) {
      try { cb(); } catch { /* isolate per-callback */ }
    }
    this.onUnmountBeforeSuper();
  }

  protected onMount(_ctx: PaneContext): void {
    /* default no-op */
  }

  protected onUnmountBeforeSuper(): void {
    /* default no-op */
  }

  protected registerUnmountCallback(cb: () => void): void {
    this.onUnmountCbs.push(cb);
  }
}
