// ── Consensus trader — result-card grid + layout switching tests ──
// Covers the Phase 5.2 additions: pre-spawned card widgets, results-
// mode layout, syncCardStates mirroring state.results[] into cards,
// mode switching (`ct-run` → 'results', `ct-back-to-picking` →
// 'picking'), and `ct-reload-personas`.

import { describe, test, expect } from 'bun:test';
import plugin, {
  buildPickingLayout, buildResultsLayout, syncCardStates,
  CT_PERSONAS_ID, CT_DETAIL_ID, CT_HEADER_ID, CT_RESULTS_ID,
  CT_CARD_IDS, CT_MAX_CARDS,
  type ConsensusTraderState, type AgentResult,
} from '../plugins/consensus-trader/plugin.js';
import type { PluginContext, SlashCommand } from '../src/plugins/core/types.js';
import type { Layout } from '../src/layout/types.js';
import type { WidgetInstance } from '../src/widgets/types.js';
import type { ListWidgetState } from '../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../widgets/markdown/widget.js';
import type { TableState } from '../widgets/table/widget.js';
import type { ResultCardState } from '../widgets/result-card/widget.js';

// ── Harness with card-widget support ──
interface Harness {
  state: ConsensusTraderState;
  ctx: PluginContext;
  cards: WidgetInstance<ResultCardState>[];
  run: (name: string, args?: string[]) => Promise<void>;
  layoutHistory: Layout[];
  notifications: string[];
  logs: string[];
}

function mkCard(id: string): WidgetInstance<ResultCardState> {
  return {
    id, type: 'result-card', character: '',
    state: {
      personaName: '', personaRole: '',
      stance: 'loading', confidence: undefined,
      summary: '', full: '', error: '',
      focused: false,
    },
  };
}

function harness(overrides: Partial<ConsensusTraderState> = {}): Harness {
  const state: ConsensusTraderState = { ...plugin.initialState(), ...overrides };
  const personas: WidgetInstance<ListWidgetState> = {
    id: CT_PERSONAS_ID, type: 'list', character: 'Personas',
    state: { items: [], cursor: 0, offset: 0, selected: new Set(), focused: true },
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
  const cards = CT_CARD_IDS.map(id => mkCard(id));
  const byId: Record<string, WidgetInstance<unknown>> = {
    [CT_PERSONAS_ID]: personas, [CT_DETAIL_ID]: detail,
    [CT_HEADER_ID]: header, [CT_RESULTS_ID]: results,
  };
  for (const c of cards) byId[c.id] = c;

  const logs: string[] = [];
  const notifications: string[] = [];
  const layoutHistory: Layout[] = [];

  const ctx: PluginContext = {
    pluginName: 'consensus-trader',
    state,
    setState: (patch) => Object.assign(state, patch),
    log: (line) => logs.push(line),
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: (id) => byId[id] ?? null,
    setLayout: (layout) => { layoutHistory.push(layout); },
  };
  state.actions = {
    notify: (m) => notifications.push(m),
    exit: () => {},
  };

  const byName = new Map<string, SlashCommand>(
    (plugin.slashCommands ?? []).map(c => [c.name, c]),
  );
  const run = async (name: string, args: string[] = []) => {
    const cmd = byName.get(name);
    if (!cmd) throw new Error(`unknown slash command: ${name}`);
    await cmd.handler(args, ctx);
  };

  return { state, ctx, cards, run, layoutHistory, notifications, logs };
}

describe('card grid — pre-spawned widget ids', () => {
  test('CT_CARD_IDS is frozen + has CT_MAX_CARDS entries', () => {
    expect(CT_CARD_IDS.length).toBe(CT_MAX_CARDS);
    expect(Object.isFrozen(CT_CARD_IDS)).toBe(true);
    for (const id of CT_CARD_IDS) expect(id).toMatch(/^ct-card-\d+$/);
  });

  test('ids are unique + indexed 0..N-1 in order', () => {
    const set = new Set(CT_CARD_IDS);
    expect(set.size).toBe(CT_CARD_IDS.length);
    CT_CARD_IDS.forEach((id, i) => expect(id).toBe(`ct-card-${i}`));
  });

  test('plugin.requiredWidgets includes result-card', () => {
    expect(plugin.requiredWidgets).toContain('result-card');
  });
});

describe('buildPickingLayout', () => {
  test('returns the v0.3-compatible 2-row 3-column shape', () => {
    const layout = buildPickingLayout();
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[0]!.cells[0]!.widgetInstanceId).toBe(CT_HEADER_ID);
    const bodyCells = layout.rows[1]!.cells.map(c => c.widgetInstanceId);
    expect(bodyCells).toEqual([CT_PERSONAS_ID, CT_DETAIL_ID, CT_RESULTS_ID]);
  });

  test('does not reference any card widget', () => {
    const layout = buildPickingLayout();
    const allIds = layout.rows.flatMap(r => r.cells.map(c => c.widgetInstanceId));
    for (const id of CT_CARD_IDS) {
      expect(allIds).not.toContain(id);
    }
  });
});

describe('buildResultsLayout', () => {
  test('returns header + N card rows + aggregator footer', () => {
    const layout = buildResultsLayout();
    expect(layout.rows[0]!.cells[0]!.widgetInstanceId).toBe(CT_HEADER_ID);
    // Last row is the detail/aggregator.
    const last = layout.rows[layout.rows.length - 1]!;
    expect(last.cells[0]!.widgetInstanceId).toBe(CT_DETAIL_ID);
  });

  test('places all CT_MAX_CARDS cards in the grid in order', () => {
    const layout = buildResultsLayout();
    const cardCells = layout.rows
      .slice(1, -1)   // strip header + aggregator
      .flatMap(r => r.cells.map(c => c.widgetInstanceId));
    expect(cardCells).toEqual([...CT_CARD_IDS]);
  });

  test('uses 4 columns × 3 rows for 12-card default', () => {
    const layout = buildResultsLayout();
    const cardRows = layout.rows.slice(1, -1);
    expect(cardRows).toHaveLength(3);
    for (const r of cardRows) expect(r.cells).toHaveLength(4);
  });
});

describe('syncCardStates', () => {
  test('copies result fields into card state (bull / confidence / summary)', () => {
    const h = harness();
    h.state.results = [
      {
        personaId: 'peter-lynch',
        personaName: 'Peter Lynch',
        stance: 'bullish',
        confidence: 0.72,
        summary: '반도체 수급 긍정',
        raw: 'full rationale body',
      },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[0]!.state.personaName).toBe('Peter Lynch');
    expect(h.cards[0]!.state.stance).toBe('bull');
    expect(h.cards[0]!.state.confidence).toBe(72);
    expect(h.cards[0]!.state.summary).toContain('반도체');
    expect(h.cards[0]!.state.full).toBe('full rationale body');
  });

  test('maps bearish / neutral / unknown to widget stances', () => {
    const h = harness();
    h.state.results = [
      { personaId: 'a', personaName: 'A', stance: 'bearish', confidence: 0.5, summary: '', raw: '' },
      { personaId: 'b', personaName: 'B', stance: 'neutral', confidence: 0.3, summary: '', raw: '' },
      { personaId: 'c', personaName: 'C', stance: 'unknown', confidence: 0.0, summary: '', raw: '' },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[0]!.state.stance).toBe('bear');
    expect(h.cards[1]!.state.stance).toBe('neutral');
    expect(h.cards[2]!.state.stance).toBe('neutral'); // unknown-without-error folds to neutral
  });

  test('error results flip stance to error', () => {
    const h = harness();
    h.state.results = [
      { personaId: 'x', personaName: 'X', stance: 'unknown', confidence: 0, summary: '', raw: '', error: 'timeout after 30s' },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[0]!.state.stance).toBe('error');
    expect(h.cards[0]!.state.error).toBe('timeout after 30s');
  });

  test('unused card slots reset to empty/loading placeholders', () => {
    const h = harness();
    // Spike a card with stale content first.
    h.cards[3]!.state.personaName = 'stale';
    h.cards[3]!.state.stance = 'bull';
    h.cards[3]!.state.summary = 'stale summary';
    h.state.results = [
      { personaId: 'a', personaName: 'A', stance: 'bullish', confidence: 0.5, summary: 'x', raw: '' },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[3]!.state.personaName).toBe('');
    expect(h.cards[3]!.state.summary).toBe('');
    expect(h.cards[3]!.state.stance).toBe('loading');
  });

  test('marks the card at state.cardCursor as focused in results mode', () => {
    const h = harness({ mode: 'results', cardCursor: 2 });
    h.state.results = [
      { personaId: 'a', personaName: 'A', stance: 'bullish', confidence: 0.5, summary: '', raw: '' },
      { personaId: 'b', personaName: 'B', stance: 'bullish', confidence: 0.5, summary: '', raw: '' },
      { personaId: 'c', personaName: 'C', stance: 'bullish', confidence: 0.5, summary: '', raw: '' },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[0]!.state.focused).toBe(false);
    expect(h.cards[1]!.state.focused).toBe(false);
    expect(h.cards[2]!.state.focused).toBe(true);
  });

  test('does not mark focus in picking mode even if cardCursor is set', () => {
    const h = harness({ mode: 'picking', cardCursor: 0 });
    h.state.results = [
      { personaId: 'a', personaName: 'A', stance: 'bullish', confidence: 0.5, summary: '', raw: '' },
    ];
    syncCardStates(h.ctx, h.state);
    expect(h.cards[0]!.state.focused).toBe(false);
  });
});

describe('slash: ct-back-to-picking', () => {
  test('flips mode to picking + clears cardCursor + setLayout called', async () => {
    const h = harness({ mode: 'results', cardCursor: 3 });
    await h.run('ct-back-to-picking');
    expect(h.state.mode).toBe('picking');
    expect(h.state.cardCursor).toBe(-1);
    expect(h.layoutHistory.length).toBe(1);
  });

  test('no-op when already in picking mode — no setLayout call', async () => {
    const h = harness({ mode: 'picking' });
    await h.run('ct-back-to-picking');
    expect(h.state.mode).toBe('picking');
    expect(h.layoutHistory.length).toBe(0);
  });
});

describe('slash: ct-move-card', () => {
  test('advances cardCursor in results mode with N results', async () => {
    const h = harness({ mode: 'results', cardCursor: 0 });
    h.state.results = Array.from({ length: 5 }, (_, i) => ({
      personaId: `p${i}`, personaName: `P${i}`,
      stance: 'bullish' as const, confidence: 0.5, summary: '', raw: '',
    }));
    await h.run('ct-move-card', ['1']);
    expect(h.state.cardCursor).toBe(1);
    await h.run('ct-move-card', ['2']);
    expect(h.state.cardCursor).toBe(3);
  });

  test('wraps at results.length boundary (both directions)', async () => {
    const h = harness({ mode: 'results', cardCursor: 0 });
    h.state.results = Array.from({ length: 3 }, (_, i) => ({
      personaId: `p${i}`, personaName: `P${i}`,
      stance: 'bullish' as const, confidence: 0.5, summary: '', raw: '',
    }));
    await h.run('ct-move-card', ['-1']);
    expect(h.state.cardCursor).toBe(2);
    await h.run('ct-move-card', ['1']);
    expect(h.state.cardCursor).toBe(0);
  });

  test('no-op in picking mode', async () => {
    const h = harness({ mode: 'picking', cardCursor: -1 });
    h.state.results = [
      { personaId: 'a', personaName: 'A', stance: 'bullish', confidence: 0.5, summary: '', raw: '' },
    ];
    await h.run('ct-move-card', ['1']);
    expect(h.state.cardCursor).toBe(-1);
  });

  test('no-op when results is empty', async () => {
    const h = harness({ mode: 'results', cardCursor: -1 });
    await h.run('ct-move-card', ['5']);
    expect(h.state.cardCursor).toBe(-1);
  });
});

describe('slash: ct-reload-personas', () => {
  test('emits a reload notification with total count', async () => {
    const h = harness();
    await h.run('ct-reload-personas');
    expect(h.notifications.some(n => /personas reloaded/.test(n))).toBe(true);
    expect(h.logs.some(l => /personas reloaded/.test(l))).toBe(true);
  });

  test('includes total + user counts in the report', async () => {
    const h = harness();
    await h.run('ct-reload-personas');
    const msg = h.notifications.find(n => /personas reloaded/.test(n)) || '';
    expect(msg).toMatch(/total=\d+/);
    expect(msg).toMatch(/user=\d+/);
  });
});

describe('slash: ct-clear-and-run', () => {
  test('clears pickedIds before invoking ct-run', async () => {
    const h = harness({
      pickedIds: new Set(['warren-buffett', 'peter-lynch']),
      // No query set → ct-run will reject after we clear, we assert
      // clear happened regardless.
    });
    await h.run('ct-clear-and-run');
    expect(h.state.pickedIds.size).toBe(0);
    // ct-run should have been attempted + rejected because query is empty.
    expect(h.notifications.some(n => n.includes('set a query'))).toBe(true);
  });
});

describe('slash visibility — Phase 5.3 hidden flag', () => {
  test('public slash commands are ≤ 10 (user-facing surface stays small)', () => {
    const pub = (plugin.slashCommands ?? []).filter(c => !c.hidden);
    expect(pub.length).toBeLessThanOrEqual(10);
  });

  test('core public commands are present (ct-run, ct-cancel, ct-set-query, ct-reload-personas, ct-help)', () => {
    const pub = new Set((plugin.slashCommands ?? []).filter(c => !c.hidden).map(c => c.name));
    for (const required of ['ct-run', 'ct-cancel', 'ct-set-query', 'ct-reload-personas', 'ct-help']) {
      expect(pub.has(required)).toBe(true);
    }
  });

  test('movement + picker internals are hidden (ct-move, ct-toggle, ct-pick-all, ct-clear-picks, ct-clear-and-run, ct-move-card, ct-cycle-focus, ct-focus-right/left, ct-cycle-focus-back, ct-move-home, ct-move-end)', () => {
    const hidden = new Set((plugin.slashCommands ?? []).filter(c => c.hidden).map(c => c.name));
    for (const expected of [
      'ct-move', 'ct-move-home', 'ct-move-end',
      'ct-focus-right', 'ct-focus-left', 'ct-cycle-focus', 'ct-cycle-focus-back',
      'ct-toggle', 'ct-pick-all', 'ct-clear-picks',
      'ct-move-card', 'ct-clear-and-run',
    ]) {
      expect(hidden.has(expected)).toBe(true);
    }
  });

  test('ct-help writes keybinding + public-command tables to the log', async () => {
    const h = harness();
    await h.run('ct-help');
    const joined = h.logs.join('\n');
    expect(joined).toMatch(/public commands/);
    expect(joined).toMatch(/keybindings/);
    // Public entry appears…
    expect(joined).toContain('/ct-run');
    // …hidden entry does not.
    expect(joined).not.toContain('/ct-move-card');
  });
});

describe('keybindings — new Phase 5.2 additions', () => {
  test('c maps to ct-clear-and-run (was ct-clear-picks)', () => {
    const byKey = new Map((plugin.keybindings ?? []).map(kb => [kb.key, kb.command]));
    expect(byKey.get('c')).toBe('ct-clear-and-run');
  });

  test('S-r maps to ct-reload-personas', () => {
    const byKey = new Map((plugin.keybindings ?? []).map(kb => [kb.key, kb.command]));
    expect(byKey.get('S-r')).toBe('ct-reload-personas');
  });

  test('b maps to ct-back-to-picking', () => {
    const byKey = new Map((plugin.keybindings ?? []).map(kb => [kb.key, kb.command]));
    expect(byKey.get('b')).toBe('ct-back-to-picking');
  });

  test('every new binding resolves to a real slash command', () => {
    const names = new Set((plugin.slashCommands ?? []).map(c => c.name));
    for (const kb of plugin.keybindings ?? []) {
      const cmdName = kb.command.split(/\s+/)[0]!;
      expect(names.has(cmdName)).toBe(true);
    }
  });
});
