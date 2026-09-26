// ── VW-term-infra Phase 3a — Built-in LayoutSpec presets ──
//
// Three canonical starting layouts. Embedded as code rather than JSON
// files so tests don't depend on disk I/O to verify their shape.
// Consumers that want the presets on disk (shareable, user-editable)
// can write the result of `buildPreset(...)` to `~/.elanous/layouts/`
// via `saveLayoutSpec`.
//
// Naming: presets reserve `preset-` as a label prefix so a user saving
// `one-pane` later won't collide with the built-in. `buildPreset()`
// stamps label + createdAt + windowId on each call so the same preset
// can be applied to multiple windows.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.5 · ~/.elanous/layouts/presets/

import { LAYOUT_SPEC_VERSION, type LayoutSpec, type LayoutSpecNode } from './types.js';

export type LayoutPresetName =
  | 'one-pane'
  | 'two-pane-split'
  | 'three-pane-split'
  | 'four-pane-kanban';

export const LAYOUT_PRESET_NAMES: readonly LayoutPresetName[] = [
  'one-pane',
  'two-pane-split',
  'three-pane-split',
  'four-pane-kanban',
];

interface BuildPresetOpts {
  /** Virtual-window id the preset binds to. */
  readonly windowId: string;
  /** Pane ids to assign to leaves. Must match the preset arity
   *  (1 / 2 / 4). Preset order: row-first, col-first. */
  readonly paneIds: readonly string[];
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
}

export function buildPreset(name: LayoutPresetName, opts: BuildPresetOpts): LayoutSpec {
  const arity = presetArity(name);
  if (opts.paneIds.length !== arity) {
    throw new Error(
      `buildPreset("${name}"): expected ${arity} pane ids, got ${opts.paneIds.length}`,
    );
  }
  const now = (opts.now ?? Date.now)();
  const root = buildPresetRoot(name, opts.windowId, opts.paneIds);
  return {
    version: LAYOUT_SPEC_VERSION,
    windowId: opts.windowId,
    createdAt: now,
    label: `preset-${name}`,
    root,
  };
}

export function presetArity(name: LayoutPresetName): number {
  switch (name) {
    case 'one-pane':         return 1;
    case 'two-pane-split':   return 2;
    case 'three-pane-split': return 3;
    case 'four-pane-kanban': return 4;
  }
}

function buildPresetRoot(
  name: LayoutPresetName,
  windowId: string,
  paneIds: readonly string[],
): LayoutSpecNode {
  const leaf = (id: string): LayoutSpecNode => ({
    kind: 'leaf',
    paneRef: { windowId, paneId: id },
  });
  switch (name) {
    case 'one-pane':
      return leaf(paneIds[0]!);
    case 'two-pane-split':
      return {
        kind: 'split',
        axis: 'col',
        children: [leaf(paneIds[0]!), leaf(paneIds[1]!)],
        sizes: [0.5, 0.5],
      };
    case 'three-pane-split':
      // Three columns of equal width. Used by H6 P4 `/agent-room 3`
      // as plan | exec | review side-by-side.
      return {
        kind: 'split',
        axis: 'col',
        children: [
          leaf(paneIds[0]!),
          leaf(paneIds[1]!),
          leaf(paneIds[2]!),
        ],
        sizes: [1 / 3, 1 / 3, 1 / 3],
      };
    case 'four-pane-kanban':
      // Four columns of equal width. Kanban-style: ToDo / Doing / Review / Done.
      return {
        kind: 'split',
        axis: 'col',
        children: [
          leaf(paneIds[0]!),
          leaf(paneIds[1]!),
          leaf(paneIds[2]!),
          leaf(paneIds[3]!),
        ],
        sizes: [0.25, 0.25, 0.25, 0.25],
      };
  }
}
