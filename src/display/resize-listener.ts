// Terminal resize listener — fills the implementation gap for the
// "readKey / mouse / resize" coordinator entry triplet documented in
// CAPABILITIES-display.md §1.3. Before this module no handler was
// attached to `process.stdout.on('resize')`, so a bare terminal
// resize produced a stale paint (old input prompt row + ghost tab
// bar) until the next keystroke triggered a redraw.
//
// Strategy: on every stdout resize event, (1) push a forced dashboard
// redraw and (2) invoke the prompt's repaint hook so input-mode
// overlays catch up too. Both calls are wrapped in try/catch so a
// transient paint error doesn't kill the listener.
//
// Non-goals (stay out of IDX-1 territory):
//   - Do NOT touch coordinator.flushOverlay cache state.
//   - Do NOT recompute modal bounds (mount-time snapshot preserved).
//   - Do NOT reach into chat.ts textInput loop internals.

export interface ResizeListenerDeps {
  draw: (opts?: { force?: boolean }) => void;
  promptCtl: { repaint: () => void };
}

/** Registers the resize listener and returns a dispose fn that
 *  detaches it. Safe to call multiple times — each call attaches a
 *  fresh listener; the caller is responsible for disposing previous
 *  installations. */
export function installResizeListener(deps: ResizeListenerDeps): () => void {
  const handler = (): void => {
    try { deps.draw({ force: true }); } catch { /* swallow — paint errors shouldn't break resize */ }
    try { deps.promptCtl.repaint(); } catch { /* swallow */ }
  };
  process.stdout.on('resize', handler);
  return (): void => {
    process.stdout.removeListener('resize', handler);
  };
}
