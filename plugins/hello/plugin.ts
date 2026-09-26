// Hello scaffold plugin — T6-K8.
//
// Minimum-viable plugin so authors have a working starting point.
// Copy this directory to `plugins/<your-name>/`, edit the name +
// slash handler, then `/plugin reload` + `/plugin activate <name>`.
//
// Contributes:
//   • one slash: /hello-wave       → logs "👋 hello from <name>"
//   • one LLM tool: HelloBoop      → logs "boop" N times
//
// Does NOT contribute panes or a custom layout — that keeps this
// scaffold small. See plugins/sync/ for the full example.

import type {
  ElanousPlugin,
  PluginContext,
  SlashCommand,
  LLMToolDef,
} from '../../src/plugins/core/types.js';

interface HelloState {
  /** How many times /hello-wave has been invoked this session. */
  waves: number;
}

const hello: ElanousPlugin<HelloState> = {
  name: 'hello',
  version: '0.1.0',
  description: 'Scaffold plugin demonstrating the minimum plugin shape.',
  initialState(): HelloState {
    return { waves: 0 };
  },
  panes: {},

  slashCommands: [
    { name: 'hello-wave', aliases: [], description: 'Wave from the hello plugin' },
    { name: 'hello-count', aliases: [], description: 'Show how many times you\'ve waved this session' },
  ] satisfies SlashCommand[],

  llmTools: [
    {
      name: 'HelloBoop',
      description: 'Log "boop" a chosen number of times (1-10).',
      parameters: {
        type: 'object',
        properties: {
          times: { type: 'integer', description: 'How many boops. Clamped to 1..10.' },
        },
        additionalProperties: false,
      },
      async dispatch(args, ctx) {
        const raw = Number((args as { times?: number }).times ?? 1);
        const n = Math.max(1, Math.min(10, Math.floor(raw)));
        for (let i = 0; i < n; i++) ctx.log(`boop ${i + 1}/${n}`);
        return `booped ${n} times`;
      },
    },
  ] satisfies LLMToolDef[],

  async onActivate(ctx: PluginContext) {
    ctx.log('[hello] activated — /hello-wave or HelloBoop to test');
    // PX-2 P5: sample ctx.persistentState consumer. Restore the
    // wave count across sessions when a host wires plugin-state.
    // Falls through silently when persistentState is absent (older
    // hosts / tests) — a scaffold plugin should never HARD-require
    // the API.
    const ps = ctx.persistentState;
    if (ps) {
      try {
        const prior = await ps.load<{ waves: number }>('counters');
        if (prior && typeof prior.waves === 'number') {
          ctx.setState({ waves: prior.waves });
          ctx.log(`[hello] restored ${prior.waves} waves from prior session`);
        }
      } catch (err: any) {
        ctx.log(`[hello] state load failed: ${err?.message ?? err}`);
      }
    }
  },

  async onDeactivate(ctx: PluginContext) {
    // PX-2 P5: persist the wave count before teardown. Scope 'user'
    // so the value survives even if the project cwd changes.
    const ps = ctx.persistentState;
    if (ps) {
      try {
        const current = ctx.state as HelloState;
        await ps.persist('counters', { waves: current.waves });
      } catch (err: any) {
        ctx.log(`[hello] state persist failed: ${err?.message ?? err}`);
      }
    }
    ctx.log('[hello] deactivated');
  },
};

export default hello;
