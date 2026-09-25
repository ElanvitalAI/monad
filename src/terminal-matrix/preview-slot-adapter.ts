// ── Terminal Matrix — preview slot adapter (Phase T2b) ──
//
// The dashboard's wd-preview pane historically held its own
// PreviewTerminal instance (dashboard.ts: `let previewTerminal`),
// separate from every session-registry-owned modal. That meant:
//   • a modal PTY couldn't be moved into the preview slot
//   • a preview PTY couldn't be promoted into a modal
//   • each path had to spawn a fresh PTY if the user wanted the
//     other surface — losing scrollback + cursor + env
//
// PreviewSlotAdapter exposes a get/set/claim/release API against a
// caller-owned pointer so matrix.move() can shuttle a
// TerminalInstance's `pty` between surfaces without respawning.
// The dashboard wires its `previewTerminal` variable through this
// adapter's getter/setter; the adapter registers a
// PlacementTransitionAdapter with the matrix so preview ↔ anything
// transitions flow through move().
//
// Key invariant: **we never stop() the PTY during claim/release.**
// Session detach uses `keepPreview:true`; preview → modal simply
// rewraps the surviving handle in a fresh InteractiveTerminalModal
// via `createInteractiveTerminalModal({...existingPreview})`.

import type { PreviewTerminal } from '../preview/terminal.js';
import type {
  GlobalTerminalId,
  TerminalInstance,
  TerminalPlacement,
} from './types.js';
import type {
  PlacementTransitionAdapter,
  TerminalRegistry,
} from './registry.js';
import type { TerminalSessionRegistry } from '../terminal/session-registry.js';

export interface PreviewSlotBinding {
  /** Read the current preview PTY (may be null). */
  get(): PreviewTerminal | null;
  /** Install a PTY in the preview slot. Replaces whatever was there.
   *  Caller is responsible for having already made sure the new PTY
   *  is alive + resized to the preview pane dims. */
  set(pty: PreviewTerminal | null): void;
  /** Optional hook — fires whenever claim/release mutates the slot.
   *  Dashboard uses this to call its `refreshWorkingDirPreview()`
   *  helper so the widget's state.text re-renders on next draw. */
  onChange?: () => void;
}

export interface PreviewSlotAdapterDeps {
  binding: PreviewSlotBinding;
  matrix: TerminalRegistry;
  /** Session registry — needed to detach/attach the legacy session
   *  so the modal wrapper survives the transition with the same
   *  legacySessionId. T1 adoption means every matrix instance
   *  originates from a TerminalSession. */
  sessionRegistry: TerminalSessionRegistry;
  /** Current terminal viewport size. Used for re-attach. */
  termSize: () => { cols: number; rows: number };
}

export class PreviewSlotAdapter {
  /** `term:<N>` currently bound to the preview slot (if any). Kept
   *  here rather than walked-off matrix state so release is O(1)
   *  and doesn't require a placement re-scan. */
  private boundId: GlobalTerminalId | null = null;
  private unregister: (() => void) | null = null;

  constructor(private readonly deps: PreviewSlotAdapterDeps) {}

  /** Register the PlacementTransitionAdapter with the matrix so
   *  `matrix.move(id, {kind:'preview'})` and the inverse route
   *  through this adapter. Idempotent — safe to call during
   *  dashboard boot even on hot-reload paths. */
  install(): () => void {
    if (this.unregister) return this.unregister;
    const adapter: PlacementTransitionAdapter = {
      name: 'preview-slot',
      canHandle: (from, to) => from.kind === 'preview' || to.kind === 'preview',
      apply: (instance, from, to) => this.handleTransition(instance, from, to),
    };
    this.unregister = this.deps.matrix.registerTransitionAdapter(adapter);
    return this.unregister;
  }

  /** The matrix instance currently occupying the preview slot, or
   *  null if the slot is empty / holds a non-matrix PreviewTerminal
   *  (e.g. the legacy `openPreviewTerminal()` path). */
  current(): TerminalInstance | null {
    return this.boundId ? this.deps.matrix.get(this.boundId) ?? null : null;
  }

  /** Explicitly clear the binding without moving the instance — used
   *  when the dashboard's onExit fires and the preview PTY died on
   *  its own, or when the user manually calls `openPreviewTerminal`
   *  which bypasses the matrix. */
  forgetBinding(): void {
    this.boundId = null;
  }

  private handleTransition(
    instance: TerminalInstance,
    from: TerminalPlacement,
    to: TerminalPlacement,
  ): void {
    // Preview → something else: release the slot first, then let
    // the target adapter / native handler install the new surface.
    if (from.kind === 'preview') {
      this.releaseIfBound(instance.id);
      // If target is modal, re-attach the legacy session so a fresh
      // ModalSurface wraps the surviving PTY.
      if (to.kind === 'modal' && instance.legacySessionId) {
        const { cols, rows } = this.deps.termSize();
        this.deps.sessionRegistry.attach(instance.legacySessionId, {
          termCols: cols,
          termRows: rows,
        });
      }
      // background: nothing further — PTY stays alive, just not
      // displayed.
      return;
    }

    // Something else → preview: release current preview occupant (if
    // any), detach the legacy modal so the PTY is standalone, then
    // install.
    if (to.kind === 'preview') {
      // Evict whatever is currently in the preview slot. If it's
      // another matrix instance, move it to background so the matrix
      // state reflects the swap.
      const priorId = this.boundId;
      if (priorId && priorId !== instance.id) {
        const prior = this.deps.matrix.get(priorId);
        if (prior) {
          this.deps.matrix.setPlacement(prior.id, { kind: 'background' });
        }
      }
      // If the instance came from a modal, detach so the PreviewTerminal
      // stops being decorated by a modal surface.
      if (from.kind === 'modal' && instance.legacySessionId) {
        this.deps.sessionRegistry.detach(instance.legacySessionId);
      }
      this.deps.binding.set(instance.pty);
      this.boundId = instance.id;
      this.deps.binding.onChange?.();
      return;
    }
  }

  private releaseIfBound(id: GlobalTerminalId): void {
    if (this.boundId !== id) return;
    this.deps.binding.set(null);
    this.boundId = null;
    this.deps.binding.onChange?.();
  }
}
