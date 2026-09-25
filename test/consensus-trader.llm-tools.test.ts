// ── Consensus trader LLM tools tests (Phase 5.4) ──

import { describe, test, expect } from 'bun:test';
import plugin, {
  CT_PERSONAS_ID, CT_HEADER_ID, CT_DETAIL_ID, CT_RESULTS_ID,
  buildPersonaListConfig,
  type ConsensusTraderState,
} from '../plugins/consensus-trader/plugin.js';
import { PERSONAS } from '../plugins/consensus-trader/personas.js';
import type { PluginContext, LLMToolDef } from '../src/plugins/core/types.js';
import type { WidgetInstance } from '../src/widgets/types.js';
import type { ListWidgetState } from '../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../widgets/markdown/widget.js';
import type { TableState } from '../widgets/table/widget.js';

interface ToolHarness {
  state: ConsensusTraderState;
  ctx: PluginContext;
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function toolHarness(overrides: Partial<ConsensusTraderState> = {}): ToolHarness {
  const state: ConsensusTraderState = { ...plugin.initialState(), ...overrides };
  const personaCfg = buildPersonaListConfig(state);
  const personas: WidgetInstance<ListWidgetState> = {
    id: CT_PERSONAS_ID, type: 'list', character: 'Personas',
    state: {
      items: personaCfg.items, icons: personaCfg.icons,
      selected: personaCfg.selected,
      cursor: 0, offset: 0, focused: true,
    },
  };
  const detail: WidgetInstance<MarkdownWidgetState> = {
    id: CT_DETAIL_ID, type: 'markdown', character: 'Detail',
    state: { text: '', scroll: 0 },
  };
  const header: WidgetInstance<MarkdownWidgetState> = {
    id: CT_HEADER_ID, type: 'markdown', character: '',
    state: { text: '', scroll: 0 },
  };
  const results: WidgetInstance<TableState> = {
    id: CT_RESULTS_ID, type: 'table', character: 'Results',
    state: { columns: [], rows: [], cursor: -1, offset: 0, focused: false },
  };
  const byId: Record<string, WidgetInstance<unknown>> = {
    [CT_PERSONAS_ID]: personas, [CT_DETAIL_ID]: detail,
    [CT_HEADER_ID]: header, [CT_RESULTS_ID]: results,
  };
  const ctx: PluginContext = {
    pluginName: 'consensus-trader',
    state,
    setState: (patch) => Object.assign(state, patch),
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: (id) => byId[id] ?? null,
  };
  const byName = new Map<string, LLMToolDef>(
    (plugin.llmTools ?? []).map(t => [t.name, t]),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`unknown llm tool: ${name}`);
    return await tool.handler(args, ctx);
  };
  return { state, ctx, call };
}

describe('LLM tool surface', () => {
  test('every tool has name, description, parameters, handler', () => {
    for (const t of plugin.llmTools ?? []) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(typeof t.parameters).toBe('object');
      expect(typeof t.handler).toBe('function');
      expect(t.name.startsWith('consensus.')).toBe(true);
    }
  });

  test('tool names are unique', () => {
    const names = (plugin.llmTools ?? []).map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('consensus.listPersonas', () => {
  test('returns the full pool when no filter is supplied', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.listPersonas') as any;
    expect(out.total).toBe(PERSONAS.length);
    expect(out.matched).toBe(PERSONAS.length);
    expect(out.personas).toHaveLength(PERSONAS.length);
  });

  test('respects the filter argument', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.listPersonas', { filter: 'finance' }) as any;
    expect(out.matched).toBeGreaterThan(0);
    expect(out.matched).toBeLessThan(PERSONAS.length);
  });

  test('rows expose id/name/role/style/domains only', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.listPersonas') as any;
    const keys = Object.keys(out.personas[0]).sort();
    expect(keys).toEqual(['domains', 'id', 'name', 'role', 'style']);
  });
});

describe('consensus.getState', () => {
  test('mirrors the current state shape (set → array)', async () => {
    const h = toolHarness({
      query: 'q', agentCount: 7,
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
    });
    const out = await h.call('consensus.getState') as any;
    expect(out.query).toBe('q');
    expect(out.agentCount).toBe(7);
    expect(out.pickedIds).toEqual([PERSONAS[0]!.id, PERSONAS[1]!.id]);
    expect(out.running).toBe(false);
    expect(out.resultCount).toBe(0);
  });
});

describe('consensus.pickPersonas', () => {
  test('replaces pickedIds with supplied valid ids', async () => {
    const h = toolHarness({ pickedIds: new Set(['old-id']) });
    const out = await h.call('consensus.pickPersonas', {
      ids: [PERSONAS[0]!.id, PERSONAS[2]!.id],
    }) as any;
    expect(out.picked).toEqual([PERSONAS[0]!.id, PERSONAS[2]!.id]);
    expect(out.unknown).toEqual([]);
    expect(h.state.pickedIds.has(PERSONAS[0]!.id)).toBe(true);
    expect(h.state.pickedIds.has('old-id')).toBe(false);
  });

  test('separates unknown ids from known ones', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.pickPersonas', {
      ids: [PERSONAS[0]!.id, 'no-such-id', 'also-fake'],
    }) as any;
    expect(out.picked).toEqual([PERSONAS[0]!.id]);
    expect(out.unknown).toEqual(['no-such-id', 'also-fake']);
  });

  test('empty array clears the picked set', async () => {
    const h = toolHarness({ pickedIds: new Set([PERSONAS[0]!.id]) });
    await h.call('consensus.pickPersonas', { ids: [] });
    expect(h.state.pickedIds.size).toBe(0);
  });
});

describe('consensus.setQuery', () => {
  test('writes the supplied query into state', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.setQuery', { query: '삼성전자 2026' }) as any;
    expect(out.query).toBe('삼성전자 2026');
    expect(h.state.query).toBe('삼성전자 2026');
  });

  test('non-string query is coerced to empty', async () => {
    const h = toolHarness({ query: 'old' });
    await h.call('consensus.setQuery', { query: 42 });
    expect(h.state.query).toBe('');
  });
});

describe('consensus.setAgentCount', () => {
  test('accepts 1..20', async () => {
    const h = toolHarness();
    const out = await h.call('consensus.setAgentCount', { count: 8 }) as any;
    expect(out.ok).toBe(true);
    expect(h.state.agentCount).toBe(8);
  });

  test('rejects out-of-range values', async () => {
    const h = toolHarness();
    const below = await h.call('consensus.setAgentCount', { count: 0 }) as any;
    const above = await h.call('consensus.setAgentCount', { count: 21 }) as any;
    const nan   = await h.call('consensus.setAgentCount', { count: 'x' }) as any;
    expect(below.ok).toBe(false);
    expect(above.ok).toBe(false);
    expect(nan.ok).toBe(false);
    expect(h.state.agentCount).toBe(5); // default untouched
  });

  test('floors floats', async () => {
    const h = toolHarness();
    await h.call('consensus.setAgentCount', { count: 3.7 });
    expect(h.state.agentCount).toBe(3);
  });
});

describe('consensus.runAnalysis', () => {
  test('rejects with structured error when query is empty', async () => {
    const h = toolHarness({ pickedIds: new Set([PERSONAS[0]!.id]) });
    const out = await h.call('consensus.runAnalysis') as any;
    expect(out.ok).toBe(false);
    expect(out.error).toContain('query is empty');
  });

  test('rejects when already running', async () => {
    const h = toolHarness({
      query: 'q', pickedIds: new Set([PERSONAS[0]!.id]), running: true,
    });
    const out = await h.call('consensus.runAnalysis') as any;
    expect(out.ok).toBe(false);
    expect(out.error).toContain('already running');
  });

  // No-picked-personas is *no longer* a guard — the runner auto-
  // samples in that case. The happy-path fan-out (picked + auto)
  // is covered in test/consensus-trader.runner.test.ts with a
  // stubbed stream so the LLM never gets called during tests.
});

describe('consensus.getResults', () => {
  test('reflects state.results as serializable rows', async () => {
    const h = toolHarness({
      results: [{
        personaId: 'a', personaName: 'A',
        stance: 'bullish', confidence: 0.7,
        summary: 'ok', raw: 'full',
      }],
    });
    const out = await h.call('consensus.getResults') as any;
    expect(out.results).toHaveLength(1);
    expect(out.results[0].personaId).toBe('a');
    expect(out.results[0].raw).toBeUndefined(); // raw deliberately dropped
    expect(out.results[0].summary).toBe('ok');
  });
});
