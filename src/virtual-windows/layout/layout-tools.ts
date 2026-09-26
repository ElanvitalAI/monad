// ── VW-term-infra Phase 3a wiring — LLM tool dispatchers ──
//
// Three tools exposed to skill-runner / dashboard / MCP:
//
//   SaveLayout({windowId, label?}) — snapshot the current window layout
//     to ~/.elanous/layouts/<slug>.layout.json. Returns the saved slug +
//     file path. Idempotent per label (re-save overwrites).
//
//   LoadLayout({slug, windowId}) — list saved layouts when slug is
//     omitted; plan restore against the window when slug is supplied.
//     Returns the LayoutSpec + restore plan (missing panes, tabs/float
//     containers, unsupported lower paths). ACTUAL mount is deferred
//     to a follow-up commit; this tool tells the LLM/user what WOULD
//     happen so they can decide.
//
//   ApplyLayoutPreset({preset, windowId, paneIds}) — build the named
//     preset (one-pane/two-pane-split/four-pane-kanban) against the
//     caller-supplied pane ids, plan the restore. Same "plan-only"
//     discipline as LoadLayout.
//
// All three are read-only on the dashboard state (save writes a file;
// no VW mutation). Apply wiring lives in a later sprint.

import type { LLMToolSpec } from '../../llm.js';
import type { WindowId } from '../addressing.js';
import type { WindowRegistry } from '../window-registry.js';
import {
  listAvailableLayouts,
  planApplyPreset,
  planLoadLayout,
  saveWindowLayout,
} from './layout-commands.js';
import { LAYOUT_PRESET_NAMES, type LayoutPresetName } from './presets.js';

// ── Tool spec builders ─────────────────────────────────────────

/** B-13-α (Phase P7-B closure) — shared shape for `target: SurfaceAddress`
 *  `kind:"window"` argument that SaveLayout / LoadLayout / ApplyLayoutPreset
 *  all accept alongside the legacy `windowId: integer`. Keeps the tool
 *  surface consistent with Screenshot / DescribeSurface / etc. */
const WINDOW_TARGET_SCHEMA = {
  type: 'object',
  description: 'SurfaceAddress · kind must be "window" · same shape used by GetUIState / DescribeSurface.',
  properties: {
    kind: { type: 'string', enum: ['window'] },
    windowId: { type: 'integer' },
  },
} as const;

export function buildSaveLayoutTool(): LLMToolSpec {
  return {
    name: 'SaveLayout',
    description:
      'Save the current layout of a virtual window to ~/.elanous/layouts/<slug>.layout.json. '
      + 'Slug derives from label (or windowId when no label). Overwrites existing slug atomically. '
      + 'Address via `target: {kind:"window", windowId}` (preferred · SurfaceAddress shape) or '
      + 'legacy `windowId: integer`.',
    parameters: {
      type: 'object',
      properties: {
        target: WINDOW_TARGET_SCHEMA,
        windowId: { type: 'integer', description: 'Legacy · use `target` for new callers.' },
        label: { type: 'string', description: 'Optional human label (used for slug + UI). Defaults to windowId.' },
      },
      // B-13-α · schema level required removed · dispatcher rejects
      // when both target and windowId are missing.
    },
  };
}

export function buildLoadLayoutTool(): LLMToolSpec {
  return {
    name: 'LoadLayout',
    description:
      'Without slug or path: list saved layouts + built-in presets available to restore. With slug OR path: plan the restore against a window — returns the LayoutSpec + a plan describing which panes would remain, which are missing, and which tabs/float containers need separate handling. Does NOT mutate the window yet; actual mount is a follow-up operation the user triggers explicitly. `path` (Bundle B-6) takes precedence over `slug` when both are supplied — useful for direct loading from `ListArtifacts({kind:"layout"})` results. Window address via `target: {kind:"window", windowId}` (preferred) or legacy `windowId: integer`.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Saved layout slug. Omit to list available.' },
        path: { type: 'string', description: 'Absolute artifact path (e.g. from ListArtifacts). Takes precedence over slug.' },
        target: WINDOW_TARGET_SCHEMA,
        windowId: { type: 'integer', description: 'Legacy · required when slug or path is supplied and `target` is omitted.' },
        keepMissingAsPlaceholder: {
          type: 'boolean',
          description: 'When true, missing leaves stay in the plan tree as-is (host composer renders placeholder). Default false — drop missing and renormalize sibling sizes.',
        },
      },
    },
  };
}

export function buildApplyLayoutPresetTool(): LLMToolSpec {
  return {
    name: 'ApplyLayoutPreset',
    description:
      'Build a named preset (one-pane | two-pane-split | four-pane-kanban) against caller-supplied pane ids, then plan the restore. Returns spec + plan. Does NOT mutate — caller decides before committing. Address via `target: {kind:"window", windowId}` (preferred) or legacy `windowId: integer`.',
    parameters: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: [...LAYOUT_PRESET_NAMES], description: 'Preset name.' },
        target: WINDOW_TARGET_SCHEMA,
        windowId: { type: 'integer', description: 'Legacy · use `target` for new callers.' },
        paneIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exactly arity(preset) pane ids (1 / 2 / 4). Row-first, col-first for 4-pane-kanban.',
        },
      },
      required: ['preset', 'paneIds'],
    },
  };
}

// ── Dispatchers ────────────────────────────────────────────────

export interface LayoutToolsDeps {
  readonly registry: WindowRegistry;
  readonly dir?: string;
  /** Bundle B-5 (P6-4) — dashboard injects the unified ArtifactStore
   *  so SaveLayout output lands in `~/.elanous/artifacts/layout/`. */
  readonly artifactStore?: import('../../artifact/index.js').ArtifactStore;
}

export async function dispatchSaveLayout(
  deps: LayoutToolsDeps,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const windowId = resolveWindowIdFromRaw(raw, 'SaveLayout');
  const label = typeof raw.label === 'string' ? raw.label : undefined;
  const result = await saveWindowLayout(
    {
      registry: deps.registry,
      ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
      ...(deps.artifactStore !== undefined ? { artifactStore: deps.artifactStore } : {}),
    },
    { windowId, ...(label !== undefined ? { label } : {}) },
  );
  return {
    ok: true,
    savedPath: result.savedPath,
    slug: result.spec.label ?? `${windowId}`,
    windowId,
    paneCount: leafCount(result.spec.root),
  };
}

export async function dispatchLoadLayout(
  deps: LayoutToolsDeps,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const slug = typeof raw.slug === 'string' ? raw.slug : undefined;
  const path = typeof raw.path === 'string' ? raw.path : undefined;
  if (slug === undefined && path === undefined) {
    const catalog = await listAvailableLayouts({
      ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
    });
    return {
      saved: catalog.saved.map((l) => ({
        slug: l.slug,
        label: l.spec.label ?? l.slug,
        windowId: l.spec.windowId,
        createdAt: l.spec.createdAt,
      })),
      skipped: catalog.skipped.map((s) => ({ slug: s.slug, reason: s.reason })),
      presets: catalog.presets,
    };
  }
  const windowId = resolveWindowIdFromRaw(raw, 'LoadLayout (with slug/path)');
  const keep = typeof raw.keepMissingAsPlaceholder === 'boolean' ? raw.keepMissingAsPlaceholder : undefined;
  const { spec, plan } = await planLoadLayout(
    {
      registry: deps.registry,
      ...(deps.dir !== undefined ? { dir: deps.dir } : {}),
      ...(deps.artifactStore !== undefined ? { artifactStore: deps.artifactStore } : {}),
    },
    {
      windowId,
      ...(slug !== undefined ? { slug } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(keep !== undefined ? { keepMissingAsPlaceholder: keep } : {}),
    },
  );
  return {
    ok: true,
    spec,
    plan: summarizePlan(plan),
    note: 'plan only — no mutation performed; follow-up tool will commit',
  };
}

export function dispatchApplyLayoutPreset(
  deps: Pick<LayoutToolsDeps, 'registry'>,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const preset = raw.preset;
  if (typeof preset !== 'string' || !LAYOUT_PRESET_NAMES.includes(preset as LayoutPresetName)) {
    throw new Error(`ApplyLayoutPreset: preset must be one of ${LAYOUT_PRESET_NAMES.join('|')}`);
  }
  const windowId = resolveWindowIdFromRaw(raw, 'ApplyLayoutPreset');
  const paneIds = raw.paneIds;
  if (!Array.isArray(paneIds) || paneIds.length === 0 || !paneIds.every((p) => typeof p === 'string')) {
    throw new Error('ApplyLayoutPreset: paneIds must be a non-empty string[]');
  }
  const { spec, plan } = planApplyPreset(deps, {
    preset: preset as LayoutPresetName,
    windowId,
    paneIds: paneIds as string[],
  });
  return {
    ok: true,
    spec,
    plan: summarizePlan(plan),
    note: 'plan only — no mutation performed; follow-up tool will commit',
  };
}

// ── Helpers ────────────────────────────────────────────────────

function parseWindowId(raw: unknown, toolName: string): WindowId {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${toolName}: windowId must be a positive integer`);
  }
  return n as WindowId;
}

/** B-13-α (Phase P7-B closure) — accept structured
 *  `target: {kind:"window", windowId}` (SurfaceAddress) or legacy
 *  `windowId: integer`. Returns a typed WindowId or throws with the
 *  tool-specific prefix. Legacy wins when both are supplied so explicit
 *  caller intent dominates — matches the PaneCapture / PaneInject
 *  precedence rule from B-11-α · B-12-α. */
function resolveWindowIdFromRaw(raw: Record<string, unknown>, toolName: string): WindowId {
  if (raw.windowId !== undefined && raw.windowId !== null) {
    return parseWindowId(raw.windowId, toolName);
  }
  const target = raw.target;
  if (target && typeof target === 'object') {
    const t = target as Record<string, unknown>;
    if (t.kind === 'window' && (typeof t.windowId === 'number' || typeof t.windowId === 'string')) {
      return parseWindowId(t.windowId, toolName);
    }
  }
  throw new Error(`${toolName}: provide 'target' (kind="window") or 'windowId'`);
}

function leafCount(node: import('./types.js').LayoutSpecNode): number {
  if (node.kind === 'leaf') return 1;
  if (node.kind === 'split') return node.children.reduce((a, c) => a + leafCount(c), 0);
  if (node.kind === 'tabs') return node.panes.length;
  return 1; // float
}

function summarizePlan(plan: import('./restore-planner.js').RestorePlan): Record<string, unknown> {
  return {
    hasBinaryRoot: plan.binaryRoot !== null,
    missing: plan.missing.map((r) => ({ windowId: r.windowId, paneId: r.paneId })),
    tabsCount: plan.tabs.length,
    floatCount: plan.floats.length,
    notes: plan.notes,
  };
}
