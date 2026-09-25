// F-B2 — Convert `MountSpec` → `ModalSurface` for the live harness.
//
// Each MountSpec.kind maps to a minimal renderable surface. These
// aren't full productions of the real widgets; they're just
// enough for scenarios to observe mount/dismiss, clickable
// regions, and context-key side effects. IDX-7 expansion
// scenarios that need the real Dialog / SelectView can replace
// these factories with full `mountViewAsModalSurface` calls —
// the harness interface stays the same.

import type { ModalSurface } from '../display/modal-stack.js';
import type { Action, DisplayMouseEvent, KeyEvent, ModalTier } from '../display/types.js';

import type {
  ButtonMountProps,
  DialogMountProps,
  MountSpec,
  SelectMountProps,
  TextMountProps,
} from './types.js';

export interface MountBuilderDeps {
  termSize: { rows: number; cols: number };
  /** Called whenever the harness-synthesised click on this
   *  component would fire. The live-harness wires this back to
   *  its `lastClickedComponentId` cache. */
  onClick: (componentId: string) => void;
}

export function buildSurfaceForMountSpec(
  spec: MountSpec,
  deps: MountBuilderDeps,
): ModalSurface {
  switch (spec.kind) {
    case 'dialog':  return buildDialogSurface(spec.id, spec.props, deps);
    case 'button':  return buildButtonSurface(spec.id, spec.props, deps);
    case 'select':  return buildSelectSurface(spec.id, spec.props, deps);
    case 'text':    return buildTextSurface(spec.id, spec.props, deps);
    case 'custom':  return buildCustomSurface(spec.id, deps);
  }
}

// ── Shared scaffold ─────────────────────────────────────────────

function baseSurface(opts: {
  id: string;
  tier: ModalTier;
  row: number; col: number; width: number; height: number;
}): ModalSurface {
  return {
    id: opts.id,
    owner: 'dashboard',
    kind: 'modal',
    tier: opts.tier,
    focus: 'owns',
    priority: 50,
    bounds: { row: opts.row, col: opts.col, width: opts.width, height: opts.height },
    render: () => [],
    paint: () => '',
    cursor: () => null,
  } as ModalSurface;
}

// ── dialog ───────────────────────────────────────────────────────

function buildDialogSurface(
  id: string,
  props: DialogMountProps,
  deps: MountBuilderDeps,
): ModalSurface {
  const width = Math.min(40, deps.termSize.cols - 4);
  const height = 5 + (props.body ? 2 : 0);
  const surface = baseSurface({
    id,
    tier: 'dialog',
    row: Math.max(1, Math.floor((deps.termSize.rows - height) / 2)),
    col: Math.max(1, Math.floor((deps.termSize.cols - width) / 2)),
    width, height,
  });
  surface.paint = () => `[dialog:${id}:${props.title}]`;
  surface.onKey = (ev: KeyEvent) => {
    // Match a button shortcut if present.
    for (const b of props.buttons) {
      if (b.buttonId && b.buttonId.toLowerCase() === (ev.name ?? '').toLowerCase()) {
        deps.onClick(`${id}:${b.buttonId}`);
        return 'consumed';
      }
    }
    if (ev.name === 'escape') {
      deps.onClick(`${id}:cancel`);
      return 'consumed';
    }
    return 'passthrough';
  };
  surface.onMouse = (ev: DisplayMouseEvent): Action => {
    // Any click inside the dialog bounds is attributed to the
    // first button when no finer hit target was provided (simple
    // behaviour; scenarios that need specific buttons should pass
    // a `hit` target with a specific buttonId).
    if (ev.hitTarget?.kind === 'modal-button') {
      deps.onClick(`${id}:${ev.hitTarget.buttonId}`);
    } else if (props.buttons[0]) {
      deps.onClick(`${id}:${props.buttons[0].buttonId ?? props.buttons[0].value}`);
    }
    return { type: 'none' };
  };
  return surface;
}

// ── button ───────────────────────────────────────────────────────

function buildButtonSurface(
  id: string,
  props: ButtonMountProps,
  deps: MountBuilderDeps,
): ModalSurface {
  const width = Math.min(props.label.length + 4, deps.termSize.cols);
  const surface = baseSurface({
    id,
    tier: 'popup',
    row: Math.max(1, Math.floor(deps.termSize.rows / 2)),
    col: Math.max(1, Math.floor((deps.termSize.cols - width) / 2)),
    width, height: 1,
  });
  surface.paint = () => `[button:${id}:${props.label}]`;
  surface.onMouse = (_ev: DisplayMouseEvent): Action => {
    deps.onClick(id);
    return { type: 'none' };
  };
  surface.onKey = (ev: KeyEvent) => {
    if (ev.name === 'enter' || ev.name === 'space') {
      deps.onClick(id);
      return 'consumed';
    }
    return 'passthrough';
  };
  return surface;
}

// ── select ───────────────────────────────────────────────────────

function buildSelectSurface(
  id: string,
  props: SelectMountProps,
  deps: MountBuilderDeps,
): ModalSurface {
  const width = Math.min(60, deps.termSize.cols - 4);
  const height = Math.min(props.options.length + 2, 10);
  const surface = baseSurface({
    id,
    tier: 'picker',
    row: Math.max(1, deps.termSize.rows - height - 2),
    col: Math.max(1, Math.floor((deps.termSize.cols - width) / 2)),
    width, height,
  });
  let cursor = props.initialCursor ?? 0;
  surface.focus = 'participates';
  surface.paint = () => `[select:${id}:cursor=${cursor}:options=${props.options.length}]`;
  surface.onKey = (ev: KeyEvent) => {
    if (ev.name === 'down' && cursor < props.options.length - 1) {
      cursor++;
      return 'consumed';
    }
    if (ev.name === 'up' && cursor > 0) {
      cursor--;
      return 'consumed';
    }
    if (ev.name === 'enter') {
      const chosen = props.options[cursor];
      if (chosen) deps.onClick(`${id}:${chosen.value}`);
      return 'consumed';
    }
    return 'passthrough';
  };
  surface.onMouse = (ev: DisplayMouseEvent): Action => {
    if (ev.hitTarget?.kind === 'modal-body' && typeof ev.hitTarget.itemIndex === 'number') {
      cursor = ev.hitTarget.itemIndex;
      const chosen = props.options[cursor];
      if (chosen) deps.onClick(`${id}:${chosen.value}`);
    }
    return { type: 'none' };
  };
  return surface;
}

// ── text (non-interactive display) ──────────────────────────────

function buildTextSurface(
  id: string,
  props: TextMountProps,
  deps: MountBuilderDeps,
): ModalSurface {
  const width = Math.min(props.text.length + 4, deps.termSize.cols);
  const surface = baseSurface({
    id,
    tier: 'tooltip',
    row: Math.max(1, Math.floor(deps.termSize.rows / 3)),
    col: Math.max(1, Math.floor((deps.termSize.cols - width) / 2)),
    width, height: 3,
  });
  surface.focus = 'none';
  surface.paint = () => `[text:${id}:${props.text}]`;
  return surface;
}

// ── custom (opaque — scenario handles its own props) ───────────

function buildCustomSurface(id: string, deps: MountBuilderDeps): ModalSurface {
  const surface = baseSurface({
    id,
    tier: 'dialog',
    row: 1, col: 1,
    width: Math.min(40, deps.termSize.cols),
    height: 3,
  });
  surface.paint = () => `[custom:${id}]`;
  return surface;
}
