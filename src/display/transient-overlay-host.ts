// R1.1 — Transient overlay authority host.
//
// Modal-like transient UI already paints through DisplayCoordinator's
// `writeOverlay` path. This host is the parallel authority for
// non-modal/transient overlay painters (overlay-sprite bundles, future
// popover/ghost decorations) that still stamp AFTER the main frame but
// should no longer be routed through ad-hoc dashboard-owned wiring.

export type TransientOverlayPainter = () => string;

export interface TransientOverlayMountSpec {
  readonly id: string;
  /** Lower values paint first. Defaults to 0. */
  readonly order?: number;
  /** Optional pre-frame cleanup pass. Host runs this before the main
   *  frame render so underlying rows can repaint over the cleanup. */
  readonly prepareFrame?: TransientOverlayPainter;
  readonly paint: TransientOverlayPainter;
}

export interface TransientOverlayHandle {
  readonly id: string;
  update(next: {
    readonly order?: number;
    readonly prepareFrame?: TransientOverlayPainter;
    readonly paint?: TransientOverlayPainter;
  }): void;
  dispose(): void;
}

export interface TransientOverlayHost {
  mount(spec: TransientOverlayMountSpec): TransientOverlayHandle;
  prepareFrame(): string;
  paint(): string;
  listIds(): readonly string[];
}

interface Entry {
  id: string;
  order: number;
  seq: number;
  prepareFrame?: TransientOverlayPainter;
  paint: TransientOverlayPainter;
}

export function createTransientOverlayHost(): TransientOverlayHost {
  let seq = 0;
  const entries = new Map<string, Entry>();

  const sortedEntries = (): Entry[] =>
    [...entries.values()].sort((a, b) =>
      a.order - b.order || a.seq - b.seq || a.id.localeCompare(b.id));

  return {
    mount(spec): TransientOverlayHandle {
      seq += 1;
      const entry: Entry = {
        id: spec.id,
        order: spec.order ?? 0,
        seq,
        prepareFrame: spec.prepareFrame,
        paint: spec.paint,
      };
      entries.set(spec.id, entry);
      return {
        id: spec.id,
        update(next): void {
          const current = entries.get(spec.id);
          if (!current) return;
          if (next.order !== undefined) current.order = next.order;
          if (next.prepareFrame !== undefined) current.prepareFrame = next.prepareFrame;
          if (next.paint !== undefined) current.paint = next.paint;
        },
        dispose(): void {
          entries.delete(spec.id);
        },
      };
    },
    prepareFrame(): string {
      const out: string[] = [];
      for (const entry of sortedEntries()) {
        if (!entry.prepareFrame) continue;
        try {
          const ansi = entry.prepareFrame();
          if (ansi.length > 0) out.push(ansi);
        } catch {
          // A transient overlay must never take down the main frame.
        }
      }
      return out.join('');
    },
    paint(): string {
      const out: string[] = [];
      for (const entry of sortedEntries()) {
        try {
          const ansi = entry.paint();
          if (ansi.length > 0) out.push(ansi);
        } catch {
          // A transient overlay must never take down the main frame.
        }
      }
      return out.join('');
    },
    listIds(): readonly string[] {
      return sortedEntries().map(entry => entry.id);
    },
  };
}
