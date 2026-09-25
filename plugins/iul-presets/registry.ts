// ── IUL Presets · Registry ────────────────────────────────────
//
// Intelligent UX Lab · Scenario 3 — "pre-built dashboard templates".
//
// A Preset is a compile-time description of a set of widgets +
// layout grid. The plugin instantiates a preset by spawning every
// widget cell (via PluginContext.spawnWidget) then calling setLayout
// with the matching grid.
//
// Why hardcoded
// ─────────────
//   This scenario does NOT use the LLM — it's the "0 external
//   dependency" consumer of the MaterializeFromIntent-adjacent
//   infrastructure (live catalog lookup + spawn loop). User-editable
//   presets + LLM-assisted picking are explicit Phase 2/4 (see
//   PLAN-iul-scenario-3-composite-preset.md §7).
//
// Why Preset ≠ WidgetSpec[]
// ─────────────────────────
//   `WidgetSpec` from iul-shared is what the LLM returns for a SINGLE
//   widget (includes confidence + reason). A Preset is author-curated
//   bundle — no confidence/reason because the bundling is the claim.
//   The two types share the `widgetType` + `config` + `character`
//   concepts but intentionally stay disjoint to avoid coupling.

import type { Size } from '../../src/layout/types.js';

export interface PresetWidgetCell {
  readonly widgetType: string;
  readonly id: string;
  readonly character?: string;
  readonly config?: Record<string, unknown>;
  readonly width: Size;
}

export interface PresetRow {
  readonly height: Size;
  readonly cells: readonly PresetWidgetCell[];
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly rows: readonly PresetRow[];
}

export const PRESET_REGISTRY: readonly Preset[] = [
  {
    id: 'newsroom',
    label: 'Newsroom',
    description: 'Markdown feed · headline list · running log',
    rows: [
      {
        height: 'flex',
        cells: [
          {
            widgetType: 'markdown',
            id: 'newsroom-feed',
            character: 'Feed',
            width: 0.5,
            config: {
              source: 'static',
              markdown:
                '# Newsroom\n\n_Static template — replace the `source` config to wire a real feed (e.g. RSS / webhook)._',
            },
          },
          {
            widgetType: 'list',
            id: 'newsroom-headlines',
            character: 'Headlines',
            width: 'flex',
          },
        ],
      },
      {
        height: 8,
        cells: [
          {
            widgetType: 'log',
            id: 'newsroom-log',
            character: 'Activity',
            width: 'flex',
          },
        ],
      },
    ],
  },
  {
    id: 'stock-watch',
    label: 'Stock Watch',
    description: 'Price chart · ticker table · sparkline rail',
    rows: [
      {
        height: 'flex',
        cells: [
          {
            widgetType: 'chart-line',
            id: 'stock-chart',
            character: 'Price',
            width: 0.6,
          },
          {
            widgetType: 'table',
            id: 'stock-tickers',
            character: 'Tickers',
            width: 'flex',
          },
        ],
      },
      {
        height: 6,
        cells: [
          {
            widgetType: 'sparkline',
            id: 'stock-sparkline',
            character: 'Trend',
            width: 'flex',
          },
        ],
      },
    ],
  },
  {
    id: 'coding-focus',
    label: 'Coding Focus',
    description: 'Docs · task list · activity log',
    rows: [
      {
        height: 'flex',
        cells: [
          {
            widgetType: 'markdown',
            id: 'coding-docs',
            character: 'Docs',
            width: 0.5,
          },
          {
            widgetType: 'list',
            id: 'coding-tasks',
            character: 'Tasks',
            width: 'flex',
          },
        ],
      },
      {
        height: 10,
        cells: [
          {
            widgetType: 'log',
            id: 'coding-log',
            character: 'Log',
            width: 'flex',
          },
        ],
      },
    ],
  },
];

/** Resolve a preset by id. Returns null for unknown ids — caller
 *  decides how to surface the error (slash log, UI toast, etc.). */
export function findPreset(id: string): Preset | null {
  return PRESET_REGISTRY.find((p) => p.id === id) ?? null;
}

/** Snapshot of the registry. Returned as a readonly array so callers
 *  can't mutate the module-level constant. */
export function listPresets(): readonly Preset[] {
  return PRESET_REGISTRY;
}
