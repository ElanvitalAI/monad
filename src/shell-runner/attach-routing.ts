// ── Shell-runner attach routing (SRF-2) ──
//
// Decides what `/shell attach <id>` should do given the handle's
// current mode + status + a `resolveVwIdByLabel` lookup. Pulled out
// of dashboard.ts so the policy is testable without booting the full
// TUI — dashboard binds the effect side (chat lines + switchTo) and
// delegates the decision here.
//
// Outcome shape is a tagged union so the caller can render the
// correct chat message / fire the correct side-effect for each.
// `reason` stays human-readable — it goes straight into a warning
// line today.

import type { ShellHandle } from './types.js';

export type AttachOutcome =
  /** Flip the VW foreground to `windowId`; handle-mode is vw/modal. */
  | { kind: 'switch-vw'; windowId: number; label: string; mode: 'vw' | 'modal' }
  /** Mode too short-lived (inline) — no attach target. */
  | { kind: 'inline'; reason: string }
  /** Mode is bg — file engine, no live surface. Includes a status
   *  label so UX can differentiate live vs settled. */
  | { kind: 'bg'; status: string; reason: string }
  /** vw/modal handle has no VW label registered (e.g. spawn fell
   *  back to the file engine before tagVwRunner fired). */
  | { kind: 'no-label'; mode: 'vw' | 'modal'; reason: string }
  /** Label exists but no VW matches it today (user closed the VW). */
  | { kind: 'no-window'; label: string; mode: 'vw' | 'modal'; reason: string };

export interface AttachRoutingDeps {
  /** Return the VW label tagged against a handle id (ShellRegistry.
   *  getVwLabel). Null when no label is registered. */
  getVwLabel: (id: string) => string | null;
  /** Find the VW whose spawnTitle matches `label`. Return the window
   *  id or null when the VW has been closed / never existed. */
  resolveVwIdByLabel: (label: string) => number | null;
}

/** Pure decision function — given a handle and the two lookups,
 *  tell the caller which branch to render. No side-effects.
 *
 *  Inline rules mirror the HANDOFF guidance:
 *    • vw / modal → 'switch-vw' when label + VW resolve, else
 *                   'no-label' or 'no-window'.
 *    • bg         → 'bg' with reason hint (`mode:"vw"` upgrade path).
 *    • inline     → 'inline'.
 */
export function decideAttach(
  handle: Pick<ShellHandle, 'id' | 'mode' | 'status'>,
  deps: AttachRoutingDeps,
): AttachOutcome {
  if (handle.mode === 'inline') {
    return { kind: 'inline', reason: 'inline mode is too short-lived to attach — output is in chat.' };
  }
  if (handle.mode === 'bg') {
    const live = handle.status === 'running' || handle.status === 'backgrounded';
    const status = live ? `live (${handle.status})` : handle.status;
    return {
      kind: 'bg',
      status,
      reason: 'bg-mode handle has no attachable surface — re-run with mode:"vw" for a live pane.',
    };
  }
  const mode = handle.mode;   // 'vw' | 'modal'
  const label = deps.getVwLabel(handle.id);
  if (!label) {
    return {
      kind: 'no-label',
      mode,
      reason: `handle has no VW label (mode=${mode}) — re-run RunShell to respawn a pane.`,
    };
  }
  const windowId = deps.resolveVwIdByLabel(label);
  if (windowId === null) {
    return {
      kind: 'no-window',
      label,
      mode,
      reason: `no VW found with spawn-title "${label}" — it may have been closed.`,
    };
  }
  return { kind: 'switch-vw', windowId, label, mode };
}
