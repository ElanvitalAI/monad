// ── Terminal Matrix — VW placement adapter (Phase T3b-a) ──
//
// Registers a PlacementTransitionAdapter that handles transitions
// touching `{kind: 'vw', windowId, slotId}`. Requires a callback to
// install / remove panes in the application's virtual-window
// registry. Decoupled from the actual VW module so this file stays
// test-friendly + the matrix core has no hard dependency on VW.
//
// Typical wiring (dashboard boot):
//   new VwPlacementAdapter({
//     matrix,
//     sessionRegistry,
//     installSlot: (windowId, slotId, terminalId) => { ... },
//     removeSlot: (windowId, slotId) => { ... },
//   }).install();
//
// On `matrix.move(id, {kind:'vw', windowId, slotId})`:
//   1. Detach session modal so the PTY is unclaimed by a surface.
//   2. Call `installSlot(windowId, slotId, terminalId)` — the VW
//      module creates a `terminal-slot` PaneContent in the target
//      slot via its own layout / split ops.
//
// On inverse (vw → anything):
//   1. Call `removeSlot(windowId, slotId)` — VW drops the slot.
//   2. If target is `modal`, re-attach session for fresh modal wrap.

import type { PlacementTransitionAdapter, TerminalRegistry } from './registry.js';
import type { GlobalTerminalId, TerminalInstance, TerminalPlacement } from './types.js';
import type { TerminalSessionRegistry } from '../terminal/session-registry.js';

export interface VwPlacementAdapterDeps {
  matrix: TerminalRegistry;
  sessionRegistry: TerminalSessionRegistry;
  termSize: () => { cols: number; rows: number };
  /** Ask the VW module to install a `terminal-slot` PaneContent
   *  referencing `terminalId` at `windowId`/`slotId`. May split the
   *  target window as needed. Throws if the target slot can't be
   *  created (window missing, pane limit exceeded, …). */
  installSlot: (windowId: string, slotId: string, terminalId: GlobalTerminalId) => void;
  /** Remove the slot previously installed. Idempotent — safe to call
   *  when the slot doesn't exist. */
  removeSlot: (windowId: string, slotId: string) => void;
}

export class VwPlacementAdapter {
  private unregister: (() => void) | null = null;
  /** `{windowId, slotId}` for the slot currently owned by each
   *  terminal id. Needed so vw → X transitions know which slot to
   *  tear down (the outgoing placement isn't preserved in `from` if
   *  matrix didn't update yet). */
  private readonly bindings = new Map<GlobalTerminalId, { windowId: string; slotId: string }>();

  constructor(private readonly deps: VwPlacementAdapterDeps) {}

  install(): () => void {
    if (this.unregister) return this.unregister;
    const adapter: PlacementTransitionAdapter = {
      name: 'vw-placement',
      canHandle: (from, to) => from.kind === 'vw' || to.kind === 'vw',
      apply: (instance, from, to) => this.handle(instance, from, to),
    };
    this.unregister = this.deps.matrix.registerTransitionAdapter(adapter);
    return this.unregister;
  }

  private handle(instance: TerminalInstance, from: TerminalPlacement, to: TerminalPlacement): void {
    if (from.kind === 'vw') {
      // Leaving VW — drop the slot regardless of where we're going.
      const binding = this.bindings.get(instance.id)
        ?? (from.kind === 'vw' ? { windowId: from.windowId, slotId: from.slotId } : null);
      if (binding) {
        try { this.deps.removeSlot(binding.windowId, binding.slotId); }
        catch { /* VW may already be gone — tolerate */ }
      }
      this.bindings.delete(instance.id);
      if (to.kind === 'modal' && instance.legacySessionId) {
        const { cols, rows } = this.deps.termSize();
        this.deps.sessionRegistry.attach(instance.legacySessionId, { termCols: cols, termRows: rows });
        return;
      }
      if (to.kind === 'vw') {
        // vw → vw (window/slot swap). Fall through to install branch.
        this.deps.installSlot(to.windowId, to.slotId, instance.id);
        this.bindings.set(instance.id, { windowId: to.windowId, slotId: to.slotId });
        return;
      }
      return;
    }

    if (to.kind === 'vw') {
      // Entering VW — detach any existing modal first so the PTY is
      // available for a fresh slot surface.
      if (from.kind === 'modal' && instance.legacySessionId) {
        this.deps.sessionRegistry.detach(instance.legacySessionId);
      }
      this.deps.installSlot(to.windowId, to.slotId, instance.id);
      this.bindings.set(instance.id, { windowId: to.windowId, slotId: to.slotId });
      return;
    }
  }
}
