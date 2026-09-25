// ── Consensus trader plugin tests ──

import { describe, test, expect } from 'bun:test';
import plugin, {
  buildPersonaListConfig,
  renderPersonaDetail,
  renderHeader,
  resultsToTableRows,
  CT_PERSONAS_ID, CT_HEADER_ID, CT_DETAIL_ID, CT_RESULTS_ID,
  type ConsensusTraderState,
  type AgentResult,
} from '../plugins/consensus-trader/plugin.js';
import {
  PERSONAS, getPersona, filterPersonas, personaLabel,
} from '../plugins/consensus-trader/personas.js';
import type { PluginContext, SlashCommand } from '../src/plugins/core/types.js';
import type { WidgetInstance } from '../src/widgets/types.js';
import type { ListWidgetState } from '../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../widgets/markdown/widget.js';
import type { TableState } from '../widgets/table/widget.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function freshState(): ConsensusTraderState {
  return plugin.initialState();
}

describe('personas loader', () => {
  test('ships at least 40 personas', () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(40);
  });

  test('every persona has the required keys + non-empty id/name', () => {
    for (const p of PERSONAS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.role).toBeTruthy();
      expect(Array.isArray(p.domains)).toBe(true);
      expect(typeof p.style).toBe('string');
    }
  });

  test('persona ids are unique', () => {
    const ids = PERSONAS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('persona labels are unique (reverse-lookup safety)', () => {
    const labels = PERSONAS.map(p => personaLabel(p));
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('getPersona returns the matching record', () => {
    const sample = PERSONAS[0]!;
    expect(getPersona(sample.id)).toBe(sample);
    expect(getPersona('no-such-persona')).toBeUndefined();
  });

  test('filterPersonas with empty query returns the full pool', () => {
    expect(filterPersonas('').length).toBe(PERSONAS.length);
  });

  test('filterPersonas is case-insensitive over id/name/role/domain', () => {
    const out = filterPersonas('finance');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(p =>
      p.id.includes('finance')
      || p.name.toLowerCase().includes('finance')
      || p.role.toLowerCase().includes('finance')
      || p.domains.some(d => d.toLowerCase().includes('finance'))
    )).toBe(true);
  });

  test('filterPersonas returns [] for no match', () => {
    expect(filterPersonas('zzzzzzzzzzz-never-match')).toEqual([]);
  });
});

describe('initialState', () => {
  test('starts with empty query + empty picked set + 5 agents', () => {
    const s = freshState();
    expect(s.query).toBe('');
    expect(s.searchText).toBe('');
    expect(s.pickedIds.size).toBe(0);
    expect(s.agentCount).toBe(5);
    expect(s.running).toBe(false);
    expect(s.results).toEqual([]);
    expect(s.focus).toBe(0);
  });
});

describe('buildPersonaListConfig', () => {
  test('reflects pickedIds onto selected labels', () => {
    const s = freshState();
    const sample = PERSONAS[0]!;
    s.pickedIds.add(sample.id);
    const cfg = buildPersonaListConfig(s);
    expect(cfg.items.length).toBe(PERSONAS.length);
    expect(cfg.selected.has(personaLabel(sample))).toBe(true);
  });

  test('honors searchText filter', () => {
    const s = freshState();
    s.searchText = 'finance';
    const cfg = buildPersonaListConfig(s);
    expect(cfg.items.length).toBeGreaterThan(0);
    expect(cfg.items.length).toBeLessThan(PERSONAS.length);
  });

  test('items and icons are parallel arrays', () => {
    const cfg = buildPersonaListConfig(freshState());
    expect(cfg.items.length).toBe(cfg.icons.length);
  });
});

describe('renderPersonaDetail', () => {
  test('returns placeholder text when nothing selected', () => {
    const out = renderPersonaDetail(null);
    expect(out).toContain('no persona');
  });

  test('renders name, role, voice, bias for a real persona', () => {
    const p = PERSONAS[0]!;
    const out = renderPersonaDetail(p.id);
    expect(out).toContain(p.name);
    expect(out).toContain(p.role);
    expect(out).toContain(p.voice);
    expect(out).toContain(p.bias);
  });

  test('unknown id returns not-found text', () => {
    const out = renderPersonaDetail('no-such-id');
    expect(out).toContain('not found');
  });
});

describe('renderHeader', () => {
  test('shows hint when query is empty', () => {
    const out = stripAnsi(renderHeader(freshState()));
    expect(out).toContain('no query');
  });

  test('shows query text when set', () => {
    const s = freshState();
    s.query = '삼성전자 2026 전망';
    expect(stripAnsi(renderHeader(s))).toContain('삼성전자 2026 전망');
  });

  test('shows running counter while running', () => {
    const s = freshState();
    s.query = 'q';
    s.running = true;
    s.results = [mockResult('a', 'bullish'), mockResult('b', 'bearish')];
    s.agentCount = 5;
    expect(stripAnsi(renderHeader(s))).toContain('running 2/5');
  });

  test('shows result count after run completes', () => {
    const s = freshState();
    s.query = 'q';
    s.results = [mockResult('a', 'neutral')];
    expect(stripAnsi(renderHeader(s))).toContain('1 results');
  });
});

describe('resultsToTableRows', () => {
  test('maps each result into a table row with four keys', () => {
    const rows = resultsToTableRows([
      mockResult('a', 'bullish', 0.8),
      mockResult('b', 'bearish', 0.6),
    ]);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]!)).toEqual(['persona', 'stance', 'conf', 'summary']);
    expect(stripAnsi(String(rows[0]!.stance))).toContain('bull');
    expect(rows[0]!.conf).toBe('0.80');
  });

  test('error rows surface error text in summary column', () => {
    const errRow = resultsToTableRows([{
      personaId: 'x', personaName: 'X',
      stance: 'unknown', confidence: 0,
      summary: '', raw: '', error: 'timeout',
    }])[0]!;
    expect(stripAnsi(String(errRow.summary))).toBe('timeout');
  });

  test('zero confidence renders as em-dash', () => {
    const row = resultsToTableRows([mockResult('a', 'neutral', 0)])[0]!;
    expect(row.conf).toBe('—');
  });
});

describe('plugin metadata', () => {
  test('declares required widgets', () => {
    expect(plugin.requiredWidgets).toContain('list');
    expect(plugin.requiredWidgets).toContain('markdown');
    expect(plugin.requiredWidgets).toContain('table');
  });

  test('isBusy reflects running flag', () => {
    const s = freshState();
    expect(plugin.isBusy!(s)).toBe(false);
    s.running = true;
    expect(plugin.isBusy!(s)).toBe(true);
  });
});

// ── helpers ──

function mockResult(
  id: string, stance: AgentResult['stance'], confidence: number = 0.5,
): AgentResult {
  return {
    personaId: id, personaName: `Persona ${id}`,
    stance, confidence,
    summary: `summary for ${id}`, raw: `full response ${id}`,
  };
}

// ── Slash-command test harness ──
// Spawns fake widget instances that the plugin's slash handlers can
// read/mutate, plus a minimal PluginContext. Real plugin-host wiring
// is covered by plugin-host tests — here we just verify state math.

interface Harness {
  state: ConsensusTraderState;
  ctx: PluginContext;
  widgets: {
    personas: WidgetInstance<ListWidgetState>;
    detail: WidgetInstance<MarkdownWidgetState>;
    header: WidgetInstance<MarkdownWidgetState>;
    results: WidgetInstance<TableState>;
  };
  logs: string[];
  notifications: string[];
  run: (name: string, args?: string[]) => Promise<void>;
}

function harness(overrides: Partial<ConsensusTraderState> = {}): Harness {
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
  const widgets = { personas, detail, header, results };
  const logs: string[] = [];
  const notifications: string[] = [];
  const byId: Record<string, WidgetInstance<unknown>> = {
    [CT_PERSONAS_ID]: personas, [CT_DETAIL_ID]: detail,
    [CT_HEADER_ID]: header, [CT_RESULTS_ID]: results,
  };
  const ctx: PluginContext = {
    pluginName: 'consensus-trader',
    state,
    setState: (patch) => Object.assign(state, patch),
    log: (line) => logs.push(line),
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: (id) => byId[id] ?? null,
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
    if (!cmd) throw new Error(`unknown slash: ${name}`);
    await cmd.handler(args, ctx);
  };
  return { state, ctx, widgets, logs, notifications, run };
}

describe('slash: ct-toggle (pick/unpick)', () => {
  test('first press picks the persona at cursor + advances cursor', async () => {
    const h = harness();
    const firstId = PERSONAS[0]!.id;
    await h.run('ct-toggle');
    expect(h.state.pickedIds.has(firstId)).toBe(true);
    expect(h.widgets.personas.state.cursor).toBe(1);
  });

  test('second press on same persona un-picks it', async () => {
    const h = harness({ pickedIds: new Set([PERSONAS[0]!.id]) });
    // Move back to that row so cursor matches
    h.widgets.personas.state.cursor = 0;
    await h.run('ct-toggle');
    expect(h.state.pickedIds.has(PERSONAS[0]!.id)).toBe(false);
  });

  test('list selected set mirrors pickedIds after toggle', async () => {
    const h = harness();
    await h.run('ct-toggle');
    const firstLabel = personaLabel(PERSONAS[0]!);
    expect(h.widgets.personas.state.selected.has(firstLabel)).toBe(true);
  });
});

describe('slash: ct-pick-all', () => {
  test('picks the full filtered pool when none are picked', async () => {
    const h = harness({ searchText: 'finance' });
    const visible = filterPersonas('finance');
    await h.run('ct-pick-all');
    for (const p of visible) expect(h.state.pickedIds.has(p.id)).toBe(true);
  });

  test('clears picks when every visible persona is already picked', async () => {
    const visible = filterPersonas('finance');
    const h = harness({
      searchText: 'finance',
      pickedIds: new Set(visible.map(p => p.id)),
    });
    await h.run('ct-pick-all');
    for (const p of visible) expect(h.state.pickedIds.has(p.id)).toBe(false);
  });
});

describe('slash: ct-clear-picks', () => {
  test('drops every picked persona', async () => {
    const h = harness({
      pickedIds: new Set([PERSONAS[0]!.id, PERSONAS[1]!.id, PERSONAS[2]!.id]),
    });
    await h.run('ct-clear-picks');
    expect(h.state.pickedIds.size).toBe(0);
  });
});

describe('slash: movement', () => {
  test('ct-move advances the cursor', async () => {
    const h = harness();
    await h.run('ct-move', ['3']);
    expect(h.widgets.personas.state.cursor).toBe(3);
  });

  test('ct-move-end jumps to the last row', async () => {
    const h = harness();
    await h.run('ct-move-end');
    expect(h.widgets.personas.state.cursor).toBe(PERSONAS.length - 1);
  });

  test('ct-move-home jumps back to row 0', async () => {
    const h = harness();
    h.widgets.personas.state.cursor = 10;
    h.widgets.personas.state.offset = 5;
    await h.run('ct-move-home');
    expect(h.widgets.personas.state.cursor).toBe(0);
    expect(h.widgets.personas.state.offset).toBe(0);
  });
});

describe('slash: focus cycling', () => {
  test('ct-cycle-focus rotates 0→1→2→0', async () => {
    const h = harness();
    await h.run('ct-cycle-focus');
    expect(h.state.focus).toBe(1);
    await h.run('ct-cycle-focus');
    expect(h.state.focus).toBe(2);
    await h.run('ct-cycle-focus');
    expect(h.state.focus).toBe(0);
  });

  test('ct-focus-right clamps at 2', async () => {
    const h = harness({ focus: 2 });
    await h.run('ct-focus-right');
    expect(h.state.focus).toBe(2);
  });

  test('ct-focus-left clamps at 0', async () => {
    const h = harness({ focus: 0 });
    await h.run('ct-focus-left');
    expect(h.state.focus).toBe(0);
  });
});

describe('slash: query + count + search', () => {
  test('ct-set-query joins args into a trimmed string', async () => {
    const h = harness();
    await h.run('ct-set-query', ['삼성전자', '2026', '전망']);
    expect(h.state.query).toBe('삼성전자 2026 전망');
  });

  test('ct-set-count rejects out-of-range values', async () => {
    const h = harness();
    await h.run('ct-set-count', ['0']);
    expect(h.state.agentCount).toBe(5);
    expect(h.notifications[0]).toContain('1..20');
    await h.run('ct-set-count', ['21']);
    expect(h.state.agentCount).toBe(5);
    await h.run('ct-set-count', ['abc']);
    expect(h.state.agentCount).toBe(5);
  });

  test('ct-set-count accepts 1..20', async () => {
    const h = harness();
    await h.run('ct-set-count', ['10']);
    expect(h.state.agentCount).toBe(10);
  });

  test('ct-set-search filters the list + resets cursor', async () => {
    const h = harness();
    h.widgets.personas.state.cursor = 40;
    await h.run('ct-set-search', ['finance']);
    expect(h.state.searchText).toBe('finance');
    expect(h.widgets.personas.state.cursor).toBe(0);
    expect(h.widgets.personas.state.items.length).toBeLessThan(PERSONAS.length);
  });
});

describe('slash: ct-run guards', () => {
  test('rejects when query is empty (even with personas picked)', async () => {
    const h = harness({ pickedIds: new Set([PERSONAS[0]!.id]) });
    await h.run('ct-run');
    expect(h.notifications.some(n => n.includes('set a query'))).toBe(true);
  });

  test('rejects when already running', async () => {
    const h = harness({ query: 'q', running: true });
    await h.run('ct-run');
    expect(h.notifications.some(n => n.includes('already running'))).toBe(true);
  });

  // Auto-mode: empty pickedIds + query set no longer rejects — the
  // runner fans to agentCount random personas. That success path
  // hits the real LLM so it's covered in
  // test/consensus-trader.runner.test.ts with a stubbed stream.
});

describe('keybindings', () => {
  test('every binding resolves to a real slash command', () => {
    const names = new Set((plugin.slashCommands ?? []).map(c => c.name));
    for (const kb of plugin.keybindings ?? []) {
      const cmdName = kb.command.split(/\s+/)[0]!;
      expect(names.has(cmdName)).toBe(true);
    }
  });

  test('space picks, tab cycles, enter runs', () => {
    const byKey = new Map((plugin.keybindings ?? []).map(kb => [kb.key, kb.command]));
    expect(byKey.get('space')).toBe('ct-toggle');
    expect(byKey.get('tab')).toBe('ct-cycle-focus');
    expect(byKey.get('enter')).toBe('ct-run');
  });
});
