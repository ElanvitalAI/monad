// ── IUL Presets plugin ────────────────────────────────────────
//
// Intelligent UX Lab · Scenario 3 — "pre-built dashboard templates".
//
// Activation flow:
//   1. user types `/plugin activate iul-presets`
//   2. plugin-host activates · onActivate prints help line
//   3. user runs `/iul-preset list` to see available templates
//   4. user runs `/iul-preset apply <id>` — plugin spawns every
//      widget cell + sets layout
//   5. `/iul-preset status` reports the active preset + widgets
//
// buildLayout is intentionally omitted — we don't want to spawn
// anything until the user explicitly picks a preset. An empty
// activate simply registers the slash commands.

import type {
  ElanousPlugin,
  PluginContext,
  SlashCommand,
} from '../../src/plugins/core/types.js';
import { PRESET_REGISTRY, findPreset, listPresets } from './registry.js';
import { instantiatePreset } from './instantiate.js';

interface IulPresetsState {
  /** Id of the most-recently-applied preset, or null before the
   *  first apply. */
  lastAppliedId: string | null;
  /** Ids of the widgets spawned by the last apply. Empty when no
   *  preset applied yet. */
  lastSpawned: readonly string[];
}

const slashCommands: SlashCommand[] = [
  {
    name: 'iul-preset',
    description:
      'IUL Scenario 3 — dashboard templates. Subcommands: list · apply <id> · status',
    handler: (args, ctx) => {
      const tokens = args.filter((s) => s.length > 0);
      const subcmd = tokens[0] ?? 'list';
      const rest = tokens.slice(1);
      const state = ctx.state as IulPresetsState;

      if (subcmd === 'list') {
        for (const p of listPresets()) {
          ctx.log(
            `[iul-presets] ${p.id.padEnd(16)} · ${p.label.padEnd(18)} · ${p.description}`,
          );
        }
        ctx.log(`[iul-presets] apply with: /iul-preset apply <id>`);
        return;
      }

      if (subcmd === 'status') {
        if (state.lastAppliedId === null) {
          ctx.log('[iul-presets] no preset applied yet — try /iul-preset list');
          return;
        }
        const applied = findPreset(state.lastAppliedId);
        const label = applied?.label ?? state.lastAppliedId;
        ctx.log(
          `[iul-presets] active: ${state.lastAppliedId} (${label}) · widgets: ${
            state.lastSpawned.length > 0 ? state.lastSpawned.join(', ') : '(none)'
          }`,
        );
        return;
      }

      if (subcmd === 'apply') {
        const id = rest[0];
        if (id === undefined) {
          ctx.log('[iul-presets] usage: /iul-preset apply <id> — see /iul-preset list');
          return;
        }
        const preset = findPreset(id);
        if (preset === null) {
          ctx.log(`[iul-presets] unknown preset "${id}" — see /iul-preset list`);
          return;
        }
        const result = instantiatePreset(preset, ctx);
        state.lastAppliedId = result.presetId;
        state.lastSpawned = result.spawnedIds;
        if (result.missingTypes.length > 0) {
          ctx.log(
            `[iul-presets] partial apply of "${preset.label}" — missing widget types: ${result.missingTypes.join(', ')}`,
          );
        }
        ctx.log(
          `[iul-presets] applied "${preset.label}" · ${result.spawnedIds.length} widget(s) spawned`,
        );
        return;
      }

      ctx.log(
        `[iul-presets] unknown subcommand "${subcmd}" — try: list · apply <id> · status`,
      );
    },
  },
];

const plugin: ElanousPlugin<IulPresetsState> = {
  name: 'iul-presets',
  version: '0.1.0',
  description:
    'IUL Scenario 3 — pre-built dashboard templates (newsroom · stock-watch · coding-focus)',

  initialState(): IulPresetsState {
    return { lastAppliedId: null, lastSpawned: [] };
  },

  // Empty: this plugin never owns dashboard pane slots; apply() spawns widgets into the host layout.
  panes: {},

  // markdown + list + log are the three widgets every preset uses.
  // chart-line, table, sparkline are optional — preset instantiation
  // filters them out gracefully when a host doesn't ship them.
  requiredWidgets: ['markdown', 'list', 'log'],

  slashCommands,

  async onActivate(ctx: PluginContext) {
    ctx.log(
      `[iul-presets] activated — ${PRESET_REGISTRY.length} preset(s) available · /iul-preset list`,
    );
  },

  async onDeactivate(ctx: PluginContext) {
    // Spawned widgets are owner-scoped (plugin-host cleans them up
    // automatically on deactivate). No manual teardown required.
    ctx.log('[iul-presets] deactivated');
  },
};

export default plugin;
