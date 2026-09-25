// ── VW-term-infra Phase 3a wiring — layout save / load / preset commands ──
//
// Orchestration layer that sits above the pure LayoutSpec helpers
// (serializer / persistence / presets / restore-planner / tree adapter)
// and connects them to the live `WindowRegistry`. Keeps the LLM tool
// dispatchers in `src/pfc/tools/layout-tools.ts` thin — they call these
// helpers and shape the results for the LLM.
//
// Scope (Phase 3a wiring):
//   - SAVE path: snapshotWindow(registry, windowId, label) → writes
//     LayoutSpec to ~/.monad/layouts/<slug>.layout.json. Fully wired.
//   - LIST path: enumerate saved specs + built-in presets.
//   - PLAN path: given a saved spec or preset, run planRestore against
//     the window's current pane id set and return the plan as JSON.
//   - APPLY path is DEFERRED — live pane spawn/mount needs VW-internal
//     mutation (panes Map, zoomedPaneId, focusedPaneId) that we're
//     keeping out of scope for this commit. The LLM tool surfaces
//     the plan so the user can decide; a follow-up commit wires the
//     actual reconstruction.

import { allPaneIds } from '../layout-tree.js';
import type { WindowId } from '../addressing.js';
import type { WindowRegistry } from '../window-registry.js';
import type { ArtifactStore } from '../../artifact/index.js';
import {
  buildPreset,
  fromBinaryTree,
  LAYOUT_PRESET_NAMES,
  listLayoutSpecs,
  loadLayoutSpec,
  loadLayoutSpecFromPath,
  planRestore,
  resolveLayoutArtifactPath,
  saveLayoutSpec,
  type LayoutPresetName,
  type LayoutSpec,
  type RestorePlan,
  type SavedLayoutListing,
  type SkippedLayoutListing,
} from './index.js';

export interface LayoutCommandsDeps {
  readonly registry: WindowRegistry;
  /** Optional layouts dir override for tests. Defaults to
   *  `~/.monad/layouts/`. */
  readonly dir?: string;
  /** Bundle B-5 (P6-4) — pass-through to `saveLayoutSpec` so SAVE
   *  path goes through the unified ArtifactStore when dashboard has
   *  wired one. Legacy fs path when absent. */
  readonly artifactStore?: ArtifactStore;
}

// ── Save ─────────────────────────────────────────────────────

export interface SaveLayoutResult {
  readonly savedPath: string;
  readonly spec: LayoutSpec;
}

export async function saveWindowLayout(
  deps: LayoutCommandsDeps,
  opts: { windowId: WindowId; label?: string },
): Promise<SaveLayoutResult> {
  const window = deps.registry.get(opts.windowId);
  if (!window) {
    throw new Error(`saveWindowLayout: window ${opts.windowId} not found`);
  }
  const tree = window.getLayoutTree();
  const spec = fromBinaryTree({
    windowId: String(opts.windowId),
    root: tree,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  });
  const savedPath = await saveLayoutSpec(spec, {
    ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
    ...(deps.artifactStore !== undefined ? { artifactStore: deps.artifactStore } : {}),
  });
  return { savedPath, spec };
}

// ── List (saved + presets) ────────────────────────────────────

export interface LayoutCatalog {
  readonly saved: readonly SavedLayoutListing[];
  readonly skipped: readonly SkippedLayoutListing[];
  readonly presets: readonly LayoutPresetName[];
}

export async function listAvailableLayouts(
  deps: Pick<LayoutCommandsDeps, 'dir'>,
): Promise<LayoutCatalog> {
  const { loaded, skipped } = await listLayoutSpecs({
    ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
  });
  return {
    saved: loaded,
    skipped,
    presets: LAYOUT_PRESET_NAMES,
  };
}

// ── Plan (saved spec / preset → restore plan) ─────────────────

export interface LayoutPlanResult {
  readonly spec: LayoutSpec;
  readonly plan: RestorePlan;
}

export async function planLoadLayout(
  deps: LayoutCommandsDeps,
  opts: {
    /** Legacy slug-only lookup (back-compat). */
    slug?: string;
    /** Bundle B-6 (P6-5) — absolute artifact path (e.g. from
     *  `ListArtifacts({kind:'layout'})`). Takes precedence over `slug`
     *  · skips slug resolution entirely · reads directly from path. */
    path?: string;
    windowId: WindowId;
    keepMissingAsPlaceholder?: boolean;
  },
): Promise<LayoutPlanResult> {
  let spec: LayoutSpec;
  if (opts.path) {
    spec = await loadLayoutSpecFromPath(opts.path);
  } else if (opts.slug) {
    // B-6 slug→artifact resolution when store is wired; legacy
    // `~/.monad/layouts/<slug>.layout.json` fallback otherwise.
    const artifactPath = deps.artifactStore
      ? resolveLayoutArtifactPath(opts.slug, deps.artifactStore)
      : null;
    if (artifactPath) {
      spec = await loadLayoutSpecFromPath(artifactPath);
    } else {
      spec = await loadLayoutSpec(opts.slug, {
        ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
      });
    }
  } else {
    throw new Error('planLoadLayout: either slug or path is required');
  }
  const available = readAvailablePaneIds(deps.registry, opts.windowId);
  const plan = planRestore({
    spec,
    availablePaneIds: available,
    ...(opts.keepMissingAsPlaceholder !== undefined
      ? { keepMissingAsPlaceholder: opts.keepMissingAsPlaceholder }
      : {}),
  });
  return { spec, plan };
}

export interface PresetPlanInput {
  readonly preset: LayoutPresetName;
  readonly windowId: WindowId;
  readonly paneIds: readonly string[];
  readonly now?: () => number;
  readonly keepMissingAsPlaceholder?: boolean;
}

export function planApplyPreset(
  deps: Pick<LayoutCommandsDeps, 'registry'>,
  opts: PresetPlanInput,
): LayoutPlanResult {
  const spec = buildPreset(opts.preset, {
    windowId: String(opts.windowId),
    paneIds: [...opts.paneIds],
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  const available = readAvailablePaneIds(deps.registry, opts.windowId);
  const plan = planRestore({
    spec,
    availablePaneIds: available,
    ...(opts.keepMissingAsPlaceholder !== undefined
      ? { keepMissingAsPlaceholder: opts.keepMissingAsPlaceholder }
      : {}),
  });
  return { spec, plan };
}

// ── Internals ────────────────────────────────────────────────

function readAvailablePaneIds(registry: WindowRegistry, windowId: WindowId): Set<string> {
  const window = registry.get(windowId);
  if (!window) return new Set();
  return new Set(allPaneIds(window.getLayoutTree()));
}
