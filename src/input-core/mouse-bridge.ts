// ── U-3 prep · Display → input-core mouse event bridge ──
//
// A pure translator from `DisplayMouseEvent` (the shape dashboard-
// mouse-wiring synthesizes from raw terminal input, including an
// optional `hitTarget` classification) to `MouseInputEvent` (the
// input-core canonical envelope consumed by the resolver). Today the
// dashboard constructs input-core mouse events inline with
// `target: {kind: 'unknown'}` (`src/dashboard.ts:10746-10754`), which
// is why input-core mouse bindings can only match `click:unknown` —
// the real `hitTarget` the wiring layer already set on the display
// event never flows through. This helper is the missing bridge.
//
// Why a separate module (not inline in dashboard)
//   U-3 proper replaces the dashboard inline literal with a call
//   into this helper. Extracting it first as a pure module gives us:
//     • full unit-test coverage before touching dashboard.ts,
//     • a stable public surface other consumers (plugins, tests)
//       can use once they start synthesising input-core events,
//     • no shared-zone edit in this prep PR — Session B's B-3/D-3
//       bundle touches the same dashboard region and we stay out of
//       their way until both bundles have merged.
//
// Phase positioning
//   - U-3 prep (this module · pure · additive · 0 dashboard touch).
//   - U-3 proper (future) · dashboard.ts:10746-10754 + chat.ts
//     streaming mouse path migrate to call buildMouseInputEventFromDisplay.
//   - U-3 core · resolver.ts mouse binding matching already reads
//     `ev.target.kind` — no change needed there; the gain is that
//     `ev.target` is finally something other than `{kind: 'unknown'}`.
//
// Cross-type mapping concern
//   display/types.ts::HitTarget and input-core/event.ts::HitTarget
//   are NOT the same union — display adds `modal-body`, `modal-button`
//   kinds input-core doesn't (yet) know about, and `vw-pane-*`
//   `windowId` is `string` on display side vs `number` on input-core.
//   Downgrades are explicit + commented; extending input-core's union
//   is U-3 core's decision, not prep's.

import type { DisplayMouseEvent, HitTarget as DisplayHitTarget } from '../display/types.js';
import type { MouseInputEvent, HitTarget as InputCoreHitTarget } from './event.js';

/** Options for `buildMouseInputEventFromDisplay`. Modifier flags
 *  (`shift`/`ctrl`/`alt`) live on `DisplayMouseEvent`'s *enclosing*
 *  `Key` struct, not on the event itself, so the caller passes them
 *  through. Keeping them separate (rather than requiring a Key-
 *  shaped input) lets plugin authors call this without also
 *  materialising a Key. */
export interface BuildMouseOpts {
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
}

/** Return type for `translateHitTarget`. A tagged union so callers
 *  that want to introspect the downgrade reason (for diagnostics,
 *  tests, or a future resolver that wants "do your best" matching)
 *  can. Downstream consumers that only need the input-core target
 *  can read `.target`. */
export interface TranslatedHitTarget {
  readonly target: InputCoreHitTarget;
  /** `true` when the display kind has an exact input-core peer.
   *  `false` when the bridge returned `{kind: 'unknown'}` because
   *  the display kind (modal-body, modal-button) has no current
   *  input-core representative. */
  readonly exact: boolean;
  /** Reason string for debug logging when `exact === false`. */
  readonly downgradeReason?: string;
}

/** Mouse event types `DisplayMouseEvent` carries but `MouseInputEvent`
 *  doesn't model with the same name. `motion` is the only mismatch —
 *  input-core uses the hover-enter/leave/over/stable quartet
 *  produced by the hover-tracker, so raw `motion` has no direct
 *  input-core peer. `buildMouseInputEventFromDisplay` collapses
 *  `motion` to `hover-over` (the closest semantic match: "pointer
 *  moved over some region"). Callers that need the finer hover
 *  state should consume the hover-tracker output directly. */
const MOTION_INPUT_CORE_PEER = 'hover-over' as const;

/** Translate a display-layer `HitTarget` (optional) to the input-
 *  core variant, annotating the downgrade reason when the mapping
 *  is lossy. `undefined` in ⇒ `{kind: 'unknown'}` out (the legacy
 *  behaviour the dashboard is doing today). */
export function translateHitTarget(
  src: DisplayHitTarget | undefined,
): TranslatedHitTarget {
  if (!src) {
    return {
      target: { kind: 'unknown' },
      exact: false,
      downgradeReason: 'no-hit-target-on-display-event',
    };
  }
  switch (src.kind) {
    case 'pill':
      // Display uses `HitPillName` (5-literal union); input-core
      // accepts a bare string. Safe widening.
      return { target: { kind: 'pill', name: src.name }, exact: true };

    case 'pane-nav-tab':
      return { target: { kind: 'pane-nav-tab', paneId: src.paneId }, exact: true };

    case 'pane-title': {
      const target: InputCoreHitTarget = src.widgetInstanceId !== undefined
        ? { kind: 'pane-title', paneId: src.paneId, widgetInstanceId: src.widgetInstanceId }
        : { kind: 'pane-title', paneId: src.paneId };
      return { target, exact: true };
    }

    case 'pane-body': {
      const target: InputCoreHitTarget = src.widgetInstanceId !== undefined
        ? { kind: 'pane-body', paneId: src.paneId, widgetInstanceId: src.widgetInstanceId }
        : { kind: 'pane-body', paneId: src.paneId };
      return { target, exact: true };
    }

    case 'status-bar':
      return { target: { kind: 'status-bar' }, exact: true };

    case 'vw-pane-title':
    case 'vw-pane-body': {
      // Display carries windowId as string; input-core expects
      // number. `Number(id)` yields `NaN` for non-numeric strings;
      // we treat that as a downgrade to 'unknown' rather than
      // emitting a bogus NaN into the resolver.
      const parsed = Number(src.windowId);
      if (!Number.isFinite(parsed)) {
        return {
          target: { kind: 'unknown' },
          exact: false,
          downgradeReason: `non-numeric-windowId:${src.windowId}`,
        };
      }
      const kind = src.kind;  // preserved as-is
      const target: InputCoreHitTarget = kind === 'vw-pane-title'
        ? { kind: 'vw-pane-title', windowId: parsed, paneId: src.paneId }
        : { kind: 'vw-pane-body', windowId: parsed, paneId: src.paneId };
      return { target, exact: true };
    }

    // Option α.2 (PLAN-option-alpha-inputcore-slice §2 α.2) —
    // modal-body / modal-button now mirror into input-core · exact
    // translation · `SurfaceId` brand string stringified at this
    // boundary so input-core union stays brand-independent. Previous
    // `downgradeReason` pattern retired · matcher cascade now
    // produces `click:modal-body.<id>` and `click:modal-button.<id>:<btn>`
    // instead of everything collapsing to `click:unknown`.
    case 'modal-body':
      return { target: { kind: 'modal-body', modalId: String(src.modalId) }, exact: true };

    case 'modal-button':
      return {
        target: { kind: 'modal-button', modalId: String(src.modalId), buttonId: src.buttonId },
        exact: true,
      };

    // DS-3a preflight (PLAN-hittarget-input-kind-extension.md) —
    // text-input widgets (chat composer 등) 1:1 exact translation.
    case 'input':
      return { target: { kind: 'input', inputId: src.inputId }, exact: true };
    default:
      // E1 / TS2366 (2026-05-17) — explicit unreachable default.
      // Future HitTarget kinds added to the display union without a
      // case here downgrade to `unknown` with a reason instead of
      // tripping the compiler.
      return {
        target: { kind: 'unknown' },
        exact: false,
        downgradeReason: `unknown-hit-target:${(src as { kind: string }).kind}`,
      };
  }
}

/** Translate a `DisplayMouseEvent` to a `MouseInputEvent`. Currently
 *  the dashboard builds this object literal inline with
 *  `target: {kind: 'unknown'}` — this helper is the drop-in
 *  replacement that finally populates `target` from the display
 *  layer's hit-test output. Pure; allocation-only (one object per
 *  call), no side effects. */
export function buildMouseInputEventFromDisplay(
  display: DisplayMouseEvent,
  opts: BuildMouseOpts = {},
): MouseInputEvent {
  const { target } = translateHitTarget(display.hitTarget);

  const type = display.type === 'motion' ? MOTION_INPUT_CORE_PEER : display.type;

  // Only spread modifier keys that are actually set — keeps the
  // resulting matcher strings clean (no `shift+` decoration when
  // shift wasn't pressed).
  const ev: MouseInputEvent = {
    kind: 'mouse',
    type,
    row: display.row,
    col: display.col,
    target,
    ...(opts.shift ? { shift: true } : {}),
    ...(opts.ctrl ? { ctrl: true } : {}),
    ...(opts.alt ? { alt: true } : {}),
  };
  return ev;
}
