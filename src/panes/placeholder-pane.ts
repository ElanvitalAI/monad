// ── VW-term-infra Phase 1 — PlaceholderPane ──
//
// The trivial pane kind. Used for empty slots, error states, and
// loading indicators. No interaction, no tap, empty snapshot — but
// it fits the Pane contract so VW rendering can route through
// polymorphic dispatch without branching on "is this slot empty".
//
// Emits a single cursor-home click region so hover events land on
// a well-formed HitTarget (Phase 4 will give it a real hit kind).

import type { Rect } from '../display/rect.js';
import { AbstractPane } from './base.js';
import type { ClickRegion, PaneKind, PaneRef } from './types.js';

export type PlaceholderReason = 'empty' | 'error' | 'loading';

export class PlaceholderPane extends AbstractPane {
  constructor(ref: PaneRef, private readonly reason: PlaceholderReason, private readonly detail?: string) {
    super(ref);
  }

  get kind(): PaneKind {
    return { kind: 'placeholder', reason: this.reason };
  }

  render(bounds: Rect): readonly ClickRegion[] {
    this.lastBounds = bounds;
    // Actual drawing stays in the host composer — PlaceholderPane
    // is observably empty. We return a single full-bounds click
    // region so hover / Capture Overlay hit-tests resolve.
    return [{ id: `${this.ref.paneId}:placeholder:${this.reason}`, rect: bounds, kind: 'placeholder' }];
  }

  protected describeTitle(): string {
    switch (this.reason) {
      case 'empty':   return 'Empty slot';
      case 'error':   return 'Error';
      case 'loading': return 'Loading…';
    }
  }

  protected describeSummary(): string {
    const base = `placeholder (${this.reason})`;
    return this.detail ? `${base}: ${this.detail}` : base;
  }
}
