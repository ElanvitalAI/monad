// ── IUL Presets plugin tests (Scenario 3) ─────────────────────
//
// Three sections:
//   1. Registry shape — id uniqueness, row structure invariants
//   2. instantiatePreset — mock ctx, verify spawnWidget + setLayout
//      side-effects + graceful missing-type handling
//   3. Plugin slash command — /iul-preset list · apply · status
//
// Fixture style mirrors plugins.iul-canvas.test.ts — tiny fake
// PluginContext with the minimum surface the plugin actually uses.

import { describe, test, expect } from 'bun:test';
import iulPresetsPlugin from '../plugins/iul-presets/plugin.js';
import {
  PRESET_REGISTRY,
  findPreset,
  listPresets,
  type Preset,
} from '../plugins/iul-presets/registry.js';
import { instantiatePreset } from '../plugins/iul-presets/instantiate.js';
import type { Layout } from '../src/layout/types.js';
import type { WidgetTypeInfo } from '../src/widgets/types.js';

// ── Fixture ─────────────────────────────────────────────

interface SpawnCall {
  readonly type: string;
  readonly id: string;
  readonly character?: string;
  readonly config?: Record<string, unknown>;
}

function makeCtx(opts: {
  availableTypes?: readonly string[] | null;
  spawnThrows?: Set<string>;   // widget types that throw on spawn
  omitSpawnWidget?: boolean;
} = {}) {
  const state: { lastAppliedId: string | null; lastSpawned: readonly string[] } = {
    lastAppliedId: null,
    lastSpawned: [],
  };
  const spawns: SpawnCall[] = [];
  const logs: string[] = [];
  let lastLayout: Layout | null = null;

  const ctx: any = {
    pluginName: 'iul-presets',
    state,
    log: (l: string) => { logs.push(l); },
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: () => null,
    setLayout: (layout: Layout) => { lastLayout = layout; },
  };

  if (!opts.omitSpawnWidget) {
    ctx.spawnWidget = (spec: SpawnCall) => {
      if (opts.spawnThrows?.has(spec.type)) {
        throw new Error(`fixture: spawn rejected for ${spec.type}`);
      }
      spawns.push(spec);
      return {
        id: spec.id,
        type: spec.type,
        character: spec.character ?? spec.id,
        state: {},
        config: spec.config,
      };
    };
  }

  if (opts.availableTypes !== null) {
    const types = opts.availableTypes ?? [
      'markdown', 'list', 'log', 'chart-line', 'table', 'sparkline',
    ];
    ctx.listWidgetTypes = (): readonly WidgetTypeInfo[] =>
      types.map((type) => ({ type, description: type } as WidgetTypeInfo));
  }

  return {
    ctx,
    state,
    spawns,
    logs,
    getLastLayout: () => lastLayout,
  };
}

// ── Section 1: Registry ────────────────────────────────

describe('iul-presets · registry', () => {
  test('PRESET_REGISTRY contains the three built-in presets', () => {
    const ids = PRESET_REGISTRY.map((p) => p.id);
    expect(ids).toEqual(['newsroom', 'stock-watch', 'coding-focus']);
  });

  test('every preset has non-empty rows and every row has ≥1 cell', () => {
    for (const preset of PRESET_REGISTRY) {
      expect(preset.rows.length).toBeGreaterThan(0);
      for (const row of preset.rows) {
        expect(row.cells.length).toBeGreaterThan(0);
      }
    }
  });

  test('preset ids are unique across the registry', () => {
    const ids = PRESET_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('findPreset resolves known id', () => {
    const preset = findPreset('newsroom');
    expect(preset).not.toBeNull();
    expect(preset!.label).toBe('Newsroom');
  });

  test('findPreset returns null for unknown id', () => {
    expect(findPreset('does-not-exist')).toBeNull();
  });

  test('listPresets returns the full registry snapshot', () => {
    expect(listPresets().length).toBe(PRESET_REGISTRY.length);
  });
});

// ── Section 2: instantiatePreset ───────────────────────

describe('iul-presets · instantiatePreset', () => {
  test('spawns every cell and sets layout with matching row structure', () => {
    const { ctx, spawns, getLastLayout } = makeCtx();
    const preset = findPreset('newsroom')!;
    const result = instantiatePreset(preset, ctx);

    expect(result.spawnedIds.length).toBe(3); // feed + headlines + log
    expect(spawns.map((s) => s.id)).toEqual([
      'newsroom-feed',
      'newsroom-headlines',
      'newsroom-log',
    ]);
    expect(result.missingTypes).toEqual([]);

    const layout = getLastLayout();
    expect(layout).not.toBeNull();
    expect(layout!.rows.length).toBe(2);
    expect(layout!.rows[0]!.cells.length).toBe(2);
    expect(layout!.rows[1]!.cells.length).toBe(1);
  });

  test('skips cells whose widget type is not in the live catalog', () => {
    const { ctx, spawns, getLastLayout } = makeCtx({
      availableTypes: ['markdown', 'list', 'log'], // omit chart-line/table/sparkline
    });
    const preset = findPreset('stock-watch')!;
    const result = instantiatePreset(preset, ctx);

    expect(result.spawnedIds.length).toBe(0);
    expect(spawns.length).toBe(0);
    expect(result.missingTypes.sort()).toEqual(['chart-line', 'sparkline', 'table']);
    // Filtered-empty grid falls back to emptyLayout (1 flex row · null cell).
    const layout = getLastLayout()!;
    expect(layout.rows.length).toBe(1);
    expect(layout.rows[0]!.cells[0]!.widgetInstanceId).toBeNull();
  });

  test('reports spawn errors and excludes failed cells from layout', () => {
    const { ctx, logs, getLastLayout } = makeCtx({
      spawnThrows: new Set(['list']),
    });
    const preset = findPreset('newsroom')!;
    const result = instantiatePreset(preset, ctx);

    expect(result.spawnedIds).toEqual(['newsroom-feed', 'newsroom-log']);
    expect(result.missingTypes).toContain('list');
    expect(logs.some((l) => l.includes('spawn failed for newsroom-headlines'))).toBe(true);

    const layout = getLastLayout();
    const firstRowIds = layout!.rows[0]!.cells.map((c) => c.widgetInstanceId);
    expect(firstRowIds).toEqual(['newsroom-feed']); // headlines excluded
  });

  test('host without spawnWidget produces empty spawnedIds and emptyLayout fallback', () => {
    const { ctx, spawns, getLastLayout } = makeCtx({ omitSpawnWidget: true });
    const preset = findPreset('newsroom')!;
    const result = instantiatePreset(preset, ctx);

    expect(spawns.length).toBe(0);
    expect(result.spawnedIds).toEqual([]);
    const layout = getLastLayout()!;
    expect(layout.rows.length).toBe(1);
    expect(layout.rows[0]!.cells[0]!.widgetInstanceId).toBeNull();
  });

  test('host without listWidgetTypes attempts every spawn (no upfront filter)', () => {
    const { ctx, spawns, getLastLayout } = makeCtx({ availableTypes: null });
    const preset = findPreset('coding-focus')!;
    const result = instantiatePreset(preset, ctx);

    expect(result.spawnedIds.length).toBe(3);
    expect(spawns.length).toBe(3);
    expect(result.missingTypes).toEqual([]);
    expect(getLastLayout()!.rows.length).toBe(2);
  });

  test('layout cell widths match preset declarations', () => {
    const { ctx, getLastLayout } = makeCtx();
    const preset = findPreset('stock-watch')!;
    instantiatePreset(preset, ctx);

    const row0 = getLastLayout()!.rows[0]!;
    expect(row0.cells[0]!.width).toBe(0.6);    // chart
    expect(row0.cells[1]!.width).toBe('flex'); // tickers
  });
});

// ── Section 3: Plugin slash command ────────────────────

describe('iul-presets · /iul-preset slash command', () => {
  const slash = iulPresetsPlugin.slashCommands!.find((c) => c.name === 'iul-preset')!;

  test('default (no subcommand) lists every preset', () => {
    const { ctx, logs } = makeCtx();
    slash.handler([], ctx);
    const presetLogs = logs.filter((l) => l.includes('[iul-presets]'));
    // 3 preset rows + 1 help footer
    expect(presetLogs.length).toBeGreaterThanOrEqual(4);
    expect(logs.some((l) => l.includes('newsroom'))).toBe(true);
    expect(logs.some((l) => l.includes('stock-watch'))).toBe(true);
    expect(logs.some((l) => l.includes('coding-focus'))).toBe(true);
  });

  test('`apply newsroom` sets state.lastAppliedId and logs success', () => {
    const { ctx, state, logs } = makeCtx();
    slash.handler(['apply', 'newsroom'], ctx);
    expect(state.lastAppliedId).toBe('newsroom');
    expect(state.lastSpawned.length).toBe(3);
    expect(logs.some((l) => l.includes('applied "Newsroom"'))).toBe(true);
  });

  test('`apply bogus-id` logs unknown error and leaves state untouched', () => {
    const { ctx, state, logs } = makeCtx();
    slash.handler(['apply', 'bogus-id'], ctx);
    expect(state.lastAppliedId).toBeNull();
    expect(logs.some((l) => l.includes('unknown preset "bogus-id"'))).toBe(true);
  });

  test('`apply` with no id prints usage hint', () => {
    const { ctx, state, logs } = makeCtx();
    slash.handler(['apply'], ctx);
    expect(state.lastAppliedId).toBeNull();
    expect(logs.some((l) => l.includes('usage:'))).toBe(true);
  });

  test('`status` before any apply reports "no preset applied"', () => {
    const { ctx, logs } = makeCtx();
    slash.handler(['status'], ctx);
    expect(logs.some((l) => l.includes('no preset applied'))).toBe(true);
  });

  test('`status` after apply reports active preset + widgets', () => {
    const { ctx, logs } = makeCtx();
    slash.handler(['apply', 'newsroom'], ctx);
    slash.handler(['status'], ctx);
    const statusLine = logs.find((l) => l.includes('active: newsroom'));
    expect(statusLine).toBeDefined();
    expect(statusLine).toContain('Newsroom');
    expect(statusLine).toContain('newsroom-feed');
  });

  test('unknown subcommand logs help line', () => {
    const { ctx, logs } = makeCtx();
    slash.handler(['destroy-all'], ctx);
    expect(logs.some((l) => l.includes('unknown subcommand "destroy-all"'))).toBe(true);
  });
});

// ── Section 4: Plugin manifest ─────────────────────────

describe('iul-presets · plugin manifest', () => {
  test('declares required MonadPlugin fields', () => {
    expect(iulPresetsPlugin.name).toBe('iul-presets');
    expect(iulPresetsPlugin.version).toBeTruthy();
    expect(iulPresetsPlugin.description.toLowerCase()).toContain('iul');
    expect(typeof iulPresetsPlugin.initialState).toBe('function');
  });

  test('requiredWidgets covers the core built-in widgets', () => {
    expect(iulPresetsPlugin.requiredWidgets).toEqual(
      expect.arrayContaining(['markdown', 'list', 'log']),
    );
  });

  test('exports a single /iul-preset slash command', () => {
    expect(iulPresetsPlugin.slashCommands?.length).toBe(1);
    expect(iulPresetsPlugin.slashCommands?.[0]?.name).toBe('iul-preset');
  });

  test('initialState returns a clean state object', () => {
    const s = iulPresetsPlugin.initialState();
    expect(s).toEqual({ lastAppliedId: null, lastSpawned: [] });
  });
});

// Type re-check — keeps `Preset` referenced.
const _typecheck: Preset = PRESET_REGISTRY[0]!;
void _typecheck;
