// ── IUL Presets · Instantiate ─────────────────────────────────
//
// Materializes a Preset inside a PluginContext: spawns each widget
// cell, then calls ctx.setLayout with the matching grid. Graceful
// degrade — cells whose widgetType is not in the live registry are
// skipped + reported as `missingTypes`, and their grid row entries
// are filtered so the layout never references a non-existent
// WidgetInstance.
//
// The function is deliberately synchronous and tolerant. Errors
// during a single spawn are caught + logged via ctx.log rather than
// bubbled — one bad cell should not abort the entire preset apply.

import type { PluginContext } from '../../src/plugins/core/types.js';
import type { LayoutRow } from '../../src/layout/types.js';
import { createLayout, emptyLayout } from '../../src/layout/host.js';
import type { Preset } from './registry.js';

export interface InstantiateResult {
  readonly presetId: string;
  /** Ids of successfully spawned widgets (in preset declaration order).
   *  May be empty if host lacks spawnWidget or every cell was
   *  missing its widgetType. */
  readonly spawnedIds: readonly string[];
  /** Unique widget types that the live catalog did NOT have. Empty
   *  on clean apply. */
  readonly missingTypes: readonly string[];
}

export function instantiatePreset(preset: Preset, ctx: PluginContext): InstantiateResult {
  // Live catalog — if the host wired PC-INTRO (Bundle 3) we get a
  // snapshot of registered widget types. Older/stub hosts return
  // undefined → we skip availability filtering and attempt every
  // spawn (the host will throw if a type is unregistered, and we
  // catch that).
  const live = ctx.listWidgetTypes?.();
  const available = live ? new Set(live.map((t) => t.type)) : null;

  const spawnedIds: string[] = [];
  const missingSet = new Set<string>();

  for (const row of preset.rows) {
    for (const cell of row.cells) {
      if (available !== null && !available.has(cell.widgetType)) {
        missingSet.add(cell.widgetType);
        continue;
      }
      if (!ctx.spawnWidget) {
        // Host doesn't support runtime spawning — leave spawnedIds
        // empty; layout will be empty; caller sees 0 spawned.
        continue;
      }
      try {
        ctx.spawnWidget({
          type: cell.widgetType,
          id: cell.id,
          character: cell.character ?? cell.widgetType,
          ...(cell.config !== undefined ? { config: cell.config } : {}),
        });
        spawnedIds.push(cell.id);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        ctx.log(`[iul-presets] spawn failed for ${cell.id} (${cell.widgetType}): ${msg}`);
        missingSet.add(cell.widgetType);
      }
    }
  }

  // Build the layout — filter cells to only successfully spawned ids,
  // drop rows that become empty after the filter.
  const spawnedSet = new Set(spawnedIds);
  const rows: LayoutRow[] = preset.rows
    .map<LayoutRow>((row) => ({
      height: row.height,
      cells: row.cells
        .filter((c) => spawnedSet.has(c.id))
        .map((c) => ({ widgetInstanceId: c.id, width: c.width })),
    }))
    .filter((row) => row.cells.length > 0);

  // createLayout rejects an empty rows array — fall back to the
  // host's emptyLayout() (single flex row, null-cell) whenever the
  // filter wiped everything out. Prevents a partial / no-op apply
  // from crashing the plugin.
  ctx.setLayout(rows.length > 0 ? createLayout(rows) : emptyLayout());

  return {
    presetId: preset.id,
    spawnedIds,
    missingTypes: [...missingSet],
  };
}
