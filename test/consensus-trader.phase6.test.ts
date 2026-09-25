// ── Phase 6 tests: auto-sample, user persona loader, UX polish ──

import { describe, test, expect } from 'bun:test';
import plugin, {
  renderResultDetail,
  renderHeader,
  refreshWidgets,
  CT_PERSONAS_ID, CT_HEADER_ID, CT_DETAIL_ID, CT_RESULTS_ID,
  buildPersonaListConfig,
  type ConsensusTraderState,
  type AgentResult,
} from '../plugins/consensus-trader/plugin.js';
import {
  PERSONAS, USER_PATH, samplePersonas,
} from '../plugins/consensus-trader/personas.js';
import { resolveAgents } from '../plugins/consensus-trader/runner.js';
import type { PluginContext } from '../src/plugins/core/types.js';
import type { WidgetInstance } from '../src/widgets/types.js';
import type { ListWidgetState } from '../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../widgets/markdown/widget.js';
import type { TableState } from '../widgets/table/widget.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

describe('samplePersonas', () => {
  test('returns exactly `count` when pool is larger', () => {
    const out = samplePersonas(PERSONAS, 5, () => 0.5);
    expect(out).toHaveLength(5);
    const ids = out.map(p => p.id);
    expect(new Set(ids).size).toBe(5); // no duplicates
  });

  test('caps at pool size when count exceeds', () => {
    const small = [PERSONAS[0]!, PERSONAS[1]!];
    const out = samplePersonas(small, 10, () => 0);
    expect(out).toHaveLength(2);
  });

  test('returns [] for count <= 0 or empty pool', () => {
    expect(samplePersonas(PERSONAS, 0)).toEqual([]);
    expect(samplePersonas([], 5)).toEqual([]);
  });

  test('seeded rand produces deterministic output', () => {
    const seed = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4];
    let i = 0; const rand = () => seed[i++ % seed.length]!;
    const a = samplePersonas(PERSONAS, 3, rand);
    i = 0;
    const b = samplePersonas(PERSONAS, 3, rand);
    expect(a.map(p => p.id)).toEqual(b.map(p => p.id));
  });
});

describe('resolveAgents auto-sampling', () => {
  test('auto-samples agentCount when pickedIds is empty', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      agentCount: 4,
    };
    const agents = resolveAgents(state, () => 0.5);
    expect(agents).toHaveLength(4);
  });

  test('auto-sample respects search filter', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      agentCount: 20, // ask for more than the filter allows
      searchText: 'finance',
    };
    const agents = resolveAgents(state, () => 0.5);
    // Every sampled persona must be finance-flavored (by domain/role).
    for (const a of agents) {
      const hay = [a.id, a.name, a.role, a.style, ...a.domains].join(' ').toLowerCase();
      expect(hay).toContain('finance');
    }
  });

  test('picked ids win over auto when both would apply', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      pickedIds: new Set([PERSONAS[0]!.id]),
      agentCount: 5,
    };
    const agents = resolveAgents(state);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe(PERSONAS[0]!.id);
  });
});

describe('persona file user override', () => {
  test('USER_PATH points at ~/.claude/consensus-trader/personas.json', () => {
    expect(USER_PATH.endsWith('.claude/consensus-trader/personas.json')).toBe(true);
  });
  // Existence test is environment-dependent — skipped here so CI
  // doesn't care whether a real user file is present.
});

describe('buildPersonaListConfig — preserveAnsi-friendly items', () => {
  test('items arrive ANSI-wrapped (C.text) so non-focused rows stay legible', () => {
    const state: ConsensusTraderState = { ...plugin.initialState() };
    const cfg = buildPersonaListConfig(state);
    // Every item has SOME ANSI escape — test in env-independent way:
    // stripping the wrappers should still yield the plain label.
    for (let i = 0; i < cfg.items.length; i++) {
      const wrapped = cfg.items[i]!;
      const stripped = stripAnsi(wrapped);
      expect(stripped).toContain(PERSONAS[i]!.name);
    }
  });

  test('selected set mirrors pickedIds with wrapped labels', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      pickedIds: new Set([PERSONAS[0]!.id]),
    };
    const cfg = buildPersonaListConfig(state);
    expect(cfg.selected.size).toBe(1);
    // The wrapped form must equal items[0] for the list widget to
    // recognize it — same C.text call site, stable output.
    expect(cfg.selected.has(cfg.items[0]!)).toBe(true);
  });
});

describe('renderResultDetail (focus === 2 drill-down)', () => {
  test('placeholder when no result selected', () => {
    expect(renderResultDetail(null)).toContain('no result yet');
  });

  test('renders persona name + stance + confidence + raw block', () => {
    const r: AgentResult = {
      personaId: 'x', personaName: 'Alice',
      stance: 'bullish', confidence: 0.72,
      summary: 'Good moat.',
      raw: 'STANCE: bullish\nCONFIDENCE: 0.72\nSUMMARY: Good moat.\nRATIONALE: long moat',
    };
    const out = renderResultDetail(r);
    expect(out).toContain('Alice');
    expect(out).toContain('BULLISH');
    expect(out).toContain('0.72');
    expect(out).toContain('long moat');
  });

  test('error result shows the failure message without a raw block', () => {
    const r: AgentResult = {
      personaId: 'x', personaName: 'Bob',
      stance: 'unknown', confidence: 0,
      summary: '', raw: '',
      error: 'timeout',
    };
    const out = renderResultDetail(r);
    expect(out).toContain('timeout');
    expect(out).not.toContain('```');
  });
});

describe('renderHeader mode indicator', () => {
  test('shows "auto" when nothing is picked', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      query: 'q', agentCount: 3,
    };
    expect(stripAnsi(renderHeader(state))).toContain('auto');
  });

  test('shows "picked N" when picks exist', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      query: 'q',
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id]),
    };
    expect(stripAnsi(renderHeader(state))).toContain('picked 2');
  });
});

// ── focus-driven detail pane ──

function makeCtxWithWidgets(state: ConsensusTraderState): {
  ctx: PluginContext;
  detail: WidgetInstance<MarkdownWidgetState>;
  results: WidgetInstance<TableState>;
  personas: WidgetInstance<ListWidgetState>;
} {
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
    state: {
      columns: [
        { key: 'persona', header: 'Persona' },
        { key: 'stance', header: 'Stance' },
      ],
      rows: [], cursor: -1, offset: 0, focused: false,
    },
  };
  const byId: Record<string, WidgetInstance<unknown>> = {
    [CT_PERSONAS_ID]: personas, [CT_DETAIL_ID]: detail,
    [CT_HEADER_ID]: header, [CT_RESULTS_ID]: results,
  };
  const ctx: PluginContext = {
    pluginName: 'consensus-trader',
    state,
    setState: () => {},
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: (id) => byId[id] ?? null,
  };
  return { ctx, detail, results, personas };
}

describe('refreshWidgets — focus-driven detail content', () => {
  test('focus 0 (personas) → detail shows persona bio', () => {
    const state: ConsensusTraderState = { ...plugin.initialState(), focus: 0 };
    const { ctx, detail } = makeCtxWithWidgets(state);
    refreshWidgets(ctx, state);
    expect(detail.state.text).toContain(PERSONAS[0]!.name);
    expect(detail.state.text).toContain(PERSONAS[0]!.voice);
  });

  test('focus 2 (results) with rows → detail shows result drill-down', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      focus: 2,
      results: [{
        personaId: 'x', personaName: 'Alice',
        stance: 'bullish', confidence: 0.9,
        summary: 'cheap', raw: 'STANCE: bullish\nCONFIDENCE: 0.9\nSUMMARY: cheap\nRATIONALE: yes',
      }],
    };
    const { ctx, detail, results } = makeCtxWithWidgets(state);
    refreshWidgets(ctx, state);
    expect(results.state.cursor).toBe(0); // auto-promoted
    expect(detail.state.text).toContain('Alice');
    expect(detail.state.text).toContain('BULLISH');
    expect(detail.state.text).toContain('yes'); // RATIONALE from raw
  });

  test('focus 2 with no results → placeholder', () => {
    const state: ConsensusTraderState = { ...plugin.initialState(), focus: 2 };
    const { ctx, detail } = makeCtxWithWidgets(state);
    refreshWidgets(ctx, state);
    expect(detail.state.text).toContain('no result yet');
  });

  test('table cursor clamps when results shrinks below it', () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      focus: 2,
      results: [{
        personaId: 'x', personaName: 'X',
        stance: 'neutral', confidence: 0, summary: '', raw: '',
      }],
    };
    const { ctx, results } = makeCtxWithWidgets(state);
    results.state.cursor = 5;
    refreshWidgets(ctx, state);
    expect(results.state.cursor).toBe(0);
  });
});

describe('ct-move focus-aware', () => {
  test('moves results cursor when focus === 2', async () => {
    const state: ConsensusTraderState = {
      ...plugin.initialState(),
      focus: 2,
      results: Array.from({ length: 5 }, (_, i) => ({
        personaId: `p${i}`, personaName: `P${i}`,
        stance: 'neutral' as const, confidence: 0, summary: '', raw: '',
      })),
    };
    const { ctx, results } = makeCtxWithWidgets(state);
    refreshWidgets(ctx, state);
    results.state.cursor = 0;
    // Invoke the slash handler directly.
    const cmd = (plugin.slashCommands ?? []).find(c => c.name === 'ct-move');
    await cmd!.handler(['2'], ctx);
    expect(results.state.cursor).toBe(2);
  });

  test('moves persona cursor when focus === 0', async () => {
    const state: ConsensusTraderState = { ...plugin.initialState(), focus: 0 };
    const { ctx, personas } = makeCtxWithWidgets(state);
    refreshWidgets(ctx, state);
    const cmd = (plugin.slashCommands ?? []).find(c => c.name === 'ct-move');
    await cmd!.handler(['3'], ctx);
    expect(personas.state.cursor).toBe(3);
  });
});
