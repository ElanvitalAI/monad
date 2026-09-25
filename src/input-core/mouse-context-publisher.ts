// ── A-7a · HitTarget projection to ContextKeys ──
//
// Pure projection from `MouseInputEvent.target` (populated by
// `buildMouseInputEventFromDisplay` in the A-1 dashboard handler) to
// context keys — `hitTargetKind` / `hitTargetSurfaceKind` /
// `hitTargetPaneId` / `hitTargetWidgetInstanceId` — so declarative when-clauses can
// match on live HitTarget state:
//
//     { "when": "hitTargetKind == 'pane-body' && viewModeKind == 'idle'",
//       "key":  "ctrl+click",
//       "command": "pane.openInEditor" }
//
// Phase positioning:
//   - A-1 (PR #298 landed) populated the input-core event's `target`
//     field from `DisplayMouseEvent.hitTarget`. Bindings' matcher
//     cascade ("click:pane-body.browser" / "click:pane-body") already
//     consumes this — that's the symbol-name matching path.
//   - A-7a (this module) adds the complementary when-clause path.
//     Identifier-based matching via context keys means a single
//     binding can express BOTH "right hit target" AND "right mode"
//     via `&&`.
//   - R5.5 extends the publisher with `hitTargetSurfaceKind`, the
//     broader canonical `SurfaceAddress.kind` family view of the same
//     hit (`vw-pane-title` -> `pane`, `modal-button` -> `modal`, ...).
//
// Differs from existing `lastClickHitKind` (IDX-5 Phase 3):
//   - `lastClickHitKind` is CLICK-only · freezes between clicks until
//     the next click.
//   - `hitTargetKind` updates on EVERY mouse event — click, scroll,
//     drag, release, motion — so bindings can match live hover/scroll
//     states, not just "the last click".
//
// Relationship to future A-7b (grammar extension):
//   A-7a uses the existing IDX-2a identifier-based when-clause (no
//   grammar change). If future user feedback shows `hitTarget.kind`
//   property-access syntax is more natural, A-7b can add it without
//   breaking these flat keys.

import type { MouseInputEvent } from './event.js';
import type { ContextKeyService } from './context-keys.js';
import { debug } from '../debug/log.js';
import { surfaceKindFromHit } from '../surface/hit-projection.js';

/** Project a mouse event's `target` onto context keys. Called by
 *  dashboard's input-core handler after
 *  `buildMouseInputEventFromDisplay` and before `resolveInputEvent`,
 *  so when-clauses see live HitTarget state for the current event.
 *
 *  Pure (no DragSession / ModalLifecycle coupling). Thin wrapper over
 *  `cks.update()` — the service's built-in equality skip means a
 *  sequence of events with the same target only fires subscribers
 *  once.
 *
 *  Callers pass the ContextKeyService directly (not a singleton
 *  lookup) so unit tests can isolate without global state. */
export function publishMouseTargetToContextKeys(
  ev: MouseInputEvent,
  cks: ContextKeyService,
): void {
  const t = ev.target;
  const surfaceKind = surfaceKindFromHit(t);

  // Default — HitTarget that don't carry pane/widget/input info reset
  // those keys to null so a stale value doesn't leak across events of
  // different kinds (e.g. an input click followed by a pill click).
  let paneId: string | null = null;
  let widgetInstanceId: string | null = null;
  let inputId: string | null = null;

  switch (t.kind) {
    case 'pane-nav-tab':
      paneId = t.paneId;
      break;
    case 'pane-title':
      paneId = t.paneId;
      widgetInstanceId = t.widgetInstanceId ?? null;
      break;
    case 'pane-body':
      paneId = t.paneId;
      widgetInstanceId = t.widgetInstanceId ?? null;
      break;
    case 'vw-pane-title':
    case 'vw-pane-body':
      paneId = t.paneId;
      break;
    case 'input':
      // DS-3a consumer landed (PR #334 `wireDragSessionToDashboard`)
      // · inputId-specific when-clauses are now actionable. Project
      // `t.inputId` as `hitTargetInputId` so declarative bindings can
      // scope to a specific composer (e.g. chat-main vs future
      // secondary inputs) via:
      //   `"hitTargetKind == 'input' && hitTargetInputId == 'chat-main'"`
      inputId = t.inputId;
      break;
    case 'modal-body':
    case 'modal-button':
      // Option α.2 · modal kinds carry `modalId` (and `buttonId` for
      // modal-button) · not projected as dedicated context keys yet.
      // Matcher cascade (`click:modal-body.<modalId>` /
      // `click:modal-button.<modalId>:<buttonId>`) already gives
      // declarative binding tables the specificity they need. A
      // follow-up (analogous to A-7a-follow's hitTargetInputId) can
      // introduce `hitTargetModalId` / `hitTargetModalButtonId` if a
      // consumer needs when-clause scoping by modalId alone.
      break;
    // pill / status-bar / unknown carry no pane/widget/input info ·
    // keys stay null.
  }

  // Equality-skip is handled inside cks.update(). If nothing changed
  // vs the previous event (e.g. two consecutive pane-body events on
  // the same pane/widget), subscribers don't fire.
  cks.update({
    hitTargetKind: t.kind,
    hitTargetSurfaceKind: surfaceKind,
    hitTargetPaneId: paneId,
    hitTargetWidgetInstanceId: widgetInstanceId,
    hitTargetInputId: inputId,
  });

  if (debug.enabled) {
    debug.log('input-core.hit-target.publish', t.kind, {
      surfaceKind, paneId, widgetInstanceId, inputId,
    });
  }
}
