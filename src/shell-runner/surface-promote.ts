// ── Surface promote (NT-B5) ──
//
// Moves a ShellHandle between surfaces at runtime so mode transitions
// feel seamless to the user:
//   inline → bg    — auto-flip after backgroundAfterMs expires
//                    (Registry drives this; promote wires it up)
//   bg → vw        — user opens the runner pane on an already-running
//                    background command
//   bg → modal     — "attach" slash pops a dedicated modal
//   modal ↔ vw     — user pulls the modal into the runner VW or
//                    detaches it back
//
// The engine never changes. Only the surfaces that subscribe to the
// handle swap. That's what makes this safe: all four surfaces hold
// only lifecycle subscriptions + local snapshots; nothing about the
// command itself lives on a surface.
//
// API shape: a caller hands in both the current surface (source)
// and the target surface (destination). We detach the source and
// attach the destination, in that order. detach() is idempotent so
// a surface that was never attached is a no-op.

import type { ShellHandle, ShellSurface } from './types.js';

export interface PromoteOpts {
  /** Fires after the new surface has attached, so integrators can
   *  publish a UI event ("runner now has command X"). */
  onPromoted?: (dest: ShellSurface['kind']) => void;
}

/** Move `handle` from `from` surface to `to` surface. Returns true
 *  when the transition happened. Returns false if `handle.status`
 *  is already settled (completed/killed) — re-attaching a dead
 *  handle to a different surface is possible but usually unhelpful,
 *  so we flag it. Pass `force:true` to override. */
export function promoteSurface(
  handle: ShellHandle,
  from: ShellSurface | null,
  to: ShellSurface,
  opts: PromoteOpts & { force?: boolean } = {},
): boolean {
  if (!opts.force && (handle.status === 'completed' || handle.status === 'killed')) {
    return false;
  }
  if (from && from !== to) from.detach();
  to.attach(handle);
  try { opts.onPromoted?.(to.kind); } catch { /* isolate */ }
  return true;
}

/** Derive the right target surface kind for an auto-bg flip from
 *  `inline` or `modal`. Used by the Registry's 15s auto-bg trigger:
 *  it asks this to know which surface to hand the handle to.
 *  Returns null when the current mode has no sensible bg flip
 *  (already bg; vw keeps its pane). */
export function autoBgTargetFor(
  currentKind: ShellSurface['kind'],
): ShellSurface['kind'] | null {
  switch (currentKind) {
    case 'inline': return 'bg';
    case 'modal': return 'bg';
    case 'bg': return null;
    case 'vw': return null;
    default: return null;
  }
}

/** Is `to` a legal manual promote target from `from`?
 *   inline → bg | vw | modal
 *   bg     → vw | modal | inline
 *   modal  → vw | bg
 *   vw     → modal | bg
 *  Same-surface transitions are always legal (useful for swapping
 *  a snapshot consumer without changing placement). */
export function isLegalPromote(
  from: ShellSurface['kind'],
  to: ShellSurface['kind'],
): boolean {
  if (from === to) return true;
  const legal: Record<ShellSurface['kind'], ShellSurface['kind'][]> = {
    inline: ['bg', 'vw', 'modal'],
    bg: ['vw', 'modal', 'inline'],
    modal: ['vw', 'bg'],
    vw: ['modal', 'bg'],
  };
  return legal[from].includes(to);
}
