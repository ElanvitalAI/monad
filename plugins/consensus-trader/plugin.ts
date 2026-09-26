// ── Consensus trader plugin (dogfood #2) ──
// Pick N expert personas from the 54-strong pool, pose a single
// question, fan the question out to the personas in parallel, and
// aggregate their stances into a table. Built on the M7a LLM tool
// bridge — slash commands + llm tools mutate state, the plugin host
// reroutes the active layout whenever state changes.
//
// Phase 5.1 scope: skeleton, personas loader, buildLayout with four
// widgets (header markdown, list, detail markdown, results table),
// onActivate/onDeactivate stubs. No selection handling, no run yet —
// 5.2 adds slash/keys, 5.3 adds the parallel runner, 5.4 the llmTools.

import type {
  ElanousPlugin, PluginContext, PluginLayoutCtx,
  SlashCommand, Keybinding, LLMToolDef,
} from '../../src/plugins/core/types.js';
import type { WidgetInstance } from '../../src/widgets/types.js';
import type { Layout } from '../../src/layout/types.js';
import type { ListWidgetState } from '../../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../../widgets/markdown/widget.js';
import type { TableState } from '../../widgets/table/widget.js';
import type { ResultCardState, ResultStance } from '../../widgets/result-card/widget.js';
import { createLayout } from '../../src/layout/host.js';
import { C } from '../../src/tui.js';
import {
  PERSONAS, USER_PERSONA_COUNT, USER_PERSONA_ERROR, USER_PATH,
  getPersona, filterPersonas, personaLabel, reloadPersonas, type Persona,
} from './personas.js';
import { runConsensus } from './runner.js';

// ── Widget ids ──
export const CT_HEADER_ID   = 'ct-header';
export const CT_PERSONAS_ID = 'ct-personas';
export const CT_DETAIL_ID   = 'ct-detail';
export const CT_RESULTS_ID  = 'ct-results';

/** Max number of result cards pre-spawned at activation. Cards
 *  beyond the current result count render as empty placeholders in
 *  the results layout; cards beyond this cap don't get a visible
 *  slot (the run still works, just without per-persona cards for
 *  the overflow — aggregator summary covers the rest). Sized to
 *  match the 20-agent upper bound of state.agentCount. */
export const CT_MAX_CARDS = 12;

/** Stable ids for the pre-spawned result cards — indexed 0..N-1.
 *  Kept as widget ids so `layout_getState` reports predictable
 *  entries, and so tests can poke card state directly. */
export const CT_CARD_IDS: readonly string[] = Object.freeze(
  Array.from({ length: CT_MAX_CARDS }, (_, i) => `ct-card-${i}`),
);

// ── State shape ──

export interface AgentResult {
  personaId: string;
  personaName: string;
  /** Short classification inferred from the model answer. 'unknown'
   *  when the response didn't include a clear verdict marker. */
  stance: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  /** 0..1 — model's self-reported confidence or 0 when absent. */
  confidence: number;
  /** One-line summary lifted from the response for quick scanning. */
  summary: string;
  /** Full response body for drill-down / copy. */
  raw: string;
  /** Error message when the persona's stream threw; leaves stance='unknown'. */
  error?: string;
}

export interface ConsensusTraderState {
  /** The user's question / prompt — injected into every persona's stream. */
  query: string;
  /** Free-text filter against the persona pool. */
  searchText: string;
  /** Canonical set of persona ids the user picked. Renderer mirrors
   *  this onto list-widget.selected via label matching. */
  pickedIds: Set<string>;
  /** N agents to run. When picked.size < agentCount we fan out by
   *  random sampling from the picked set (repeats allowed). */
  agentCount: number;
  /** True while a parallel stream is in flight — drives isBusy gate. */
  running: boolean;
  /** Latest results — cleared on each new run. */
  results: AgentResult[];
  /** Which of the three body columns has focus (0=personas,1=detail,2=results). */
  focus: 0 | 1 | 2;
  /** Active UI mode. 'picking' = persona list + detail + results-
   *  table layout (default; existing v0.3 behaviour). 'results' =
   *  post-run card grid (rows × cells of result-card widgets) +
   *  bottom aggregator pane. Flipped by `/ct-run` on success and
   *  flipped back by `/ct-back-to-picking` (keybinding `b`). */
  mode: 'picking' | 'results';
  /** Cursor into the results-mode card grid. -1 when no card has
   *  been focused since the run completed; changed by h/j/k/l in
   *  results mode so the drill-down modal knows which card to
   *  expand. */
  cardCursor: number;
  /** In results mode only: which pane the j/k cursor steers — the
   *  4×3 card grid up top, or the aggregator/detail markdown at
   *  the bottom. Toggled by Tab so the user can scroll the bottom
   *  pane without dropping back to picking. Defaults to 'cards'
   *  on every entry into results mode. */
  resultsFocus: 'cards' | 'detail';
  /** Phase D: opt-in flag — run the Data Collector agent before
   *  personas, seed commonGround for all of them. */
  useDataCollector: boolean;
  /** Phase D: opt-in flag — run the Aggregator after all personas
   *  settle, populate aggregatorOutput. */
  useAggregator: boolean;
  /** Phase D: Data Collector output — injected as a shared prefix
   *  into every persona's system prompt (cache-friendly). Empty when
   *  the phase is disabled or the agent produced nothing. */
  commonGround: string;
  /** Phase D: Aggregator output (markdown). Surfaced in the detail
   *  pane when focus sits on the middle column. */
  aggregatorOutput: string;
  /** Dashboard-owned hooks. Set after onActivate by the host. */
  actions?: ConsensusTraderActions;
}

export interface ConsensusTraderActions {
  /** Surface a one-line log message. Defaults to ctx.log if unset. */
  notify?(msg: string): void;
  /** Leave the plugin (plugin-host.deactivate). Dashboard wires this
   *  after activation; absent until then (ct-cancel becomes a no-op). */
  exit?(): void;
}

// ── Helpers ──

/** Build the list-widget payload from the current filter. Items are
 *  pre-colored labels (C.text) paired with a style tag icon (C.info).
 *  Paired with `preserveAnsi: true` on the widget so non-focused /
 *  non-selected rows stay legible instead of dimming into the
 *  background — the consensus pane is often inspected while focus
 *  sits on the results table. */
export function buildPersonaListConfig(state: ConsensusTraderState): {
  items: string[];
  icons: string[];
  selected: Set<string>;
} {
  const filtered = filterPersonas(state.searchText);
  const items = filtered.map(p => C.text(personaLabel(p)));
  const icons = filtered.map(p => C.info(`[${p.style}]`));
  const selected = new Set<string>();
  for (const p of filtered) {
    if (state.pickedIds.has(p.id)) selected.add(C.text(personaLabel(p)));
  }
  return { items, icons, selected };
}

/** Reverse-lookup a persona from a list-widget item (pre-colored
 *  label). Used to resolve the row currently under the cursor. */
function personaFromItem(item: string | undefined): Persona | undefined {
  if (!item) return undefined;
  // items/selected use C.text(label) — strip ANSI then match.
  const plain = item.replace(/\x1b\[[0-9;]*m/g, '');
  return PERSONAS.find(p => personaLabel(p) === plain);
}

/** Render the persona bio for the pool browser (focus === 0). */
export function renderPersonaDetail(personaId: string | null): string {
  if (!personaId) return '*(no persona selected — j/k to move)*';
  const p = getPersona(personaId);
  if (!p) return `*(persona "${personaId}" not found)*`;
  const lines: string[] = [];
  lines.push(`## ${p.name}`);
  lines.push(`_${p.role}_ — style: **${p.style}**`);
  lines.push('');
  lines.push(`**Voice.** ${p.voice}`);
  lines.push('');
  lines.push(`**Bias.** ${p.bias}`);
  lines.push('');
  if (p.domains.length) {
    lines.push('**Domains**');
    lines.push(p.domains.map(d => `- ${d}`).join('\n'));
    lines.push('');
  }
  if (p.frameworks.length) {
    lines.push('**Frameworks**');
    lines.push(p.frameworks.map(f => `- ${f}`).join('\n'));
  }
  return lines.join('\n');
}

/** Render the full rationale drill-down for a single AgentResult.
 *  Used when focus === 2 (results table) so the user can step through
 *  each row and read that persona's full answer alongside the
 *  parsed stance / confidence. */
export function renderResultDetail(result: AgentResult | null): string {
  if (!result) return '*(no result yet — press Enter to run, then j/k to browse)*';
  const lines: string[] = [];
  lines.push(`## ${result.personaName}`);
  const tag = stanceMarker(result.stance);
  const conf = result.confidence > 0 ? result.confidence.toFixed(2) : '—';
  lines.push(`**${tag}** · confidence ${conf}`);
  lines.push('');
  if (result.error) {
    lines.push(`_Error:_ ${result.error}`);
    return lines.join('\n');
  }
  if (result.summary) {
    lines.push(`> ${result.summary}`);
    lines.push('');
  }
  if (result.raw) {
    lines.push('```');
    lines.push(result.raw);
    lines.push('```');
  }
  return lines.join('\n');
}

function stanceMarker(stance: AgentResult['stance']): string {
  switch (stance) {
    case 'bullish': return '▲ BULLISH';
    case 'bearish': return '▼ BEARISH';
    case 'neutral': return '◆ NEUTRAL';
    default:        return '? UNKNOWN';
  }
}

/** Render the one-line header. Query left, state right. Shows the
 *  auto-vs-picked mode so users know whether their count will be
 *  sampled from the pool or pulled from the preset. */
export function renderHeader(state: ConsensusTraderState): string {
  const left = state.query
    ? `${C.highlight('consensus')}  ${C.text(state.query)}`
    : `${C.highlight('consensus')}  ${C.muted('(no query — /ct-set-query <text>)')}`;
  let right: string;
  if (state.running) {
    right = C.warning(`running ${state.results.length}/${state.agentCount}`);
  } else if (state.results.length > 0) {
    right = C.success(`${state.results.length} results`);
  } else {
    const mode = state.pickedIds.size > 0
      ? C.info(`picked ${state.pickedIds.size}`)
      : C.info('auto');
    right = C.muted(`agents ${state.agentCount} · ${mode}`);
  }
  return `${left}    ${right}`;
}

/** Flatten AgentResult[] into TableState rows with colorized stance. */
export function resultsToTableRows(results: AgentResult[]): TableState['rows'] {
  return results.map(r => ({
    persona: r.personaName,
    stance: stanceBadge(r.stance),
    conf: r.confidence > 0 ? r.confidence.toFixed(2) : '—',
    summary: r.error ? C.error(r.error) : r.summary,
  }));
}

function stanceBadge(stance: AgentResult['stance']): string {
  switch (stance) {
    case 'bullish': return C.success('▲ bull');
    case 'bearish': return C.error('▼ bear');
    case 'neutral': return C.info('◆ neut');
    default:        return C.muted('? unk');
  }
}

// ── buildLayout ──

function buildLayout(ctx: PluginLayoutCtx<ConsensusTraderState>): Layout {
  ctx.spawnWidget({
    type: 'markdown',
    id: CT_HEADER_ID,
    character: '',
    config: { text: renderHeader(ctx.state) },
  });

  const personaCfg = buildPersonaListConfig(ctx.state);
  const personaWidget = ctx.spawnWidget({
    type: 'list',
    id: CT_PERSONAS_ID,
    character: `Personas (${PERSONAS.length}${USER_PERSONA_COUNT > 0 ? ` · ${USER_PERSONA_COUNT} user` : ''})`,
    config: { items: personaCfg.items, icons: personaCfg.icons },
  });
  // preserveAnsi: true — items arrive pre-colored by
  // buildPersonaListConfig so non-focused rows stay readable
  // instead of collapsing into C.dim.
  (personaWidget.state as ListWidgetState).preserveAnsi = true;

  ctx.spawnWidget({
    type: 'markdown',
    id: CT_DETAIL_ID,
    character: 'Detail',
    config: { text: renderPersonaDetail(null) },
  });

  ctx.spawnWidget({
    type: 'table',
    id: CT_RESULTS_ID,
    character: 'Results',
    config: {
      columns: [
        { key: 'persona',  header: 'Persona', width: 18 },
        { key: 'stance',   header: 'Stance',  width: 8 },
        { key: 'conf',     header: 'Conf',    width: 5, align: 'right' },
        { key: 'summary',  header: 'Summary', width: 'flex' },
      ],
      rows: [],
    },
  });

  // Pre-spawn the full card grid — all CT_MAX_CARDS instances live
  // from activation through deactivation. The results layout places
  // them in a 4×3 grid (rows × cells); the picking layout leaves
  // them unplaced (widget-host keeps the instances, layout-render
  // just doesn't reference them). Syncing runner output flips each
  // card's state (stance, confidence, …) in place — no widget
  // spawn/dispose per run means card cursors stay stable across
  // re-runs and the layout swap is cheap.
  for (const id of CT_CARD_IDS) {
    ctx.spawnWidget({
      type: 'result-card',
      id,
      character: '',
      config: { stance: 'loading' satisfies ResultStance, personaName: '' },
    });
  }

  // Initial selection mirror (in case state already has pickedIds)
  syncPersonaListSelection(ctx.plugin, ctx.state);
  updateFocusFlags(ctx.plugin, ctx.state);

  return buildPickingLayout();
}

/** The v0.3-compatible 3-column layout: personas + detail + results
 *  table. Used in `mode: 'picking'` (default, pre-run) and when the
 *  user flips back via the `b` keybinding after inspecting results. */
export function buildPickingLayout(): Layout {
  return createLayout([
    { height: 1, cells: [{ widgetInstanceId: CT_HEADER_ID, width: 'flex' }] },
    { height: 'flex', cells: [
      { widgetInstanceId: CT_PERSONAS_ID, width: 0.32 },
      { widgetInstanceId: CT_DETAIL_ID,   width: 0.30 },
      { widgetInstanceId: CT_RESULTS_ID,  width: 'flex' },
    ]},
  ]);
}

/** Results-mode layout: 4 cards per row × 3 rows = 12 cards (full
 *  width), with the aggregator/detail markdown spanning the bottom
 *  6 rows. Switched in by `/ct-run` via `ctx.setLayout()` so cards
 *  can take over the whole viewport for rich browsing, then `b`
 *  returns to picking. */
export function buildResultsLayout(): Layout {
  const cardsPerRow = 4;
  const cardRows: Layout['rows'] = [];
  for (let r = 0; r < CT_MAX_CARDS / cardsPerRow; r++) {
    const cells = [];
    for (let c = 0; c < cardsPerRow; c++) {
      cells.push({
        widgetInstanceId: CT_CARD_IDS[r * cardsPerRow + c]!,
        width: 'flex' as const,
      });
    }
    cardRows.push({ height: 'flex' as const, cells });
  }
  return createLayout([
    { height: 1, cells: [{ widgetInstanceId: CT_HEADER_ID, width: 'flex' }] },
    ...cardRows,
    // Aggregator / drill-down markdown spans the bottom — reuses the
    // existing detail widget id so refreshWidgets' single-pane update
    // path already keeps it current (rationale of focused card +
    // aggregator summary + research brief, layered).
    { height: 6, cells: [{ widgetInstanceId: CT_DETAIL_ID, width: 'flex' }] },
  ]);
}

/** Map the plugin's internal stance label ('bullish'|'bearish'|
 *  'neutral'|'unknown') to the result-card widget's more terse
 *  enum. Unknown folds to loading (pre-result) or neutral (post-
 *  result, when the model replied but didn't pick a verdict). */
function stanceForCard(
  s: AgentResult['stance'],
  error: string | undefined,
): ResultStance {
  if (error) return 'error';
  if (s === 'bullish') return 'bull';
  if (s === 'bearish') return 'bear';
  if (s === 'neutral') return 'neutral';
  return 'neutral';
}

/** Mirror the current `state.results[]` + `state.pickedIds` into
 *  the pre-spawned card widgets. Cards past the active set render
 *  as empty placeholders; cards whose personas are still running
 *  keep stance='loading'. Call from runner's per-persona completion
 *  hook + from refreshWidgets so the card grid tracks state. */
export function syncCardStates(
  ctx: PluginContext,
  state: ConsensusTraderState,
): void {
  // Build the persona list in the same order the runner produces
  // results — matches `state.results[]` for settled agents and the
  // resolved agent list (picked or sampled) for still-running ones.
  // We mirror results directly here; in-flight personas show
  // stance='loading'.
  const results = state.results;
  for (let i = 0; i < CT_MAX_CARDS; i++) {
    const id = CT_CARD_IDS[i]!;
    const w = ctx.getWidget(id) as WidgetInstance<ResultCardState> | null;
    if (!w) continue;
    const r = results[i];
    if (!r) {
      // Unused slot — reset to the empty-loading placeholder so a
      // re-run doesn't surface stale content from a prior turn.
      w.state.personaName = '';
      w.state.personaRole = '';
      w.state.stance = state.running ? 'loading' : 'loading';
      w.state.confidence = undefined;
      w.state.summary = '';
      w.state.full = '';
      w.state.error = '';
      w.state.focused = false;
      continue;
    }
    const persona = getPersona(r.personaId);
    w.state.personaName = r.personaName;
    w.state.personaRole = persona?.role;
    w.state.stance = stanceForCard(r.stance, r.error);
    // runner exposes confidence 0..1; the widget wants 0..100.
    w.state.confidence = r.confidence > 0 ? Math.round(r.confidence * 100) : undefined;
    w.state.summary = r.summary;
    w.state.full = r.raw;
    w.state.error = r.error;
    w.state.focused = state.mode === 'results' && state.cardCursor === i;
  }
}

/** Push the state.pickedIds set through to list-widget.selected.
 *  Called after any mutation that could change selection (space /
 *  search filter / llm tool). */
export function syncPersonaListSelection(
  ctx: PluginContext,
  state: ConsensusTraderState,
): void {
  const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
  if (!w) return;
  const cfg = buildPersonaListConfig(state);
  w.state.items = cfg.items;
  w.state.icons = cfg.icons;
  w.state.selected = cfg.selected;
  if (w.state.cursor >= cfg.items.length) {
    w.state.cursor = Math.max(0, cfg.items.length - 1);
  }
}

/** Update all per-widget `focused` flags from state.focus. */
export function updateFocusFlags(
  ctx: PluginContext,
  state: ConsensusTraderState,
): void {
  const personas = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
  const results = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
  const detail  = ctx.getWidget(CT_DETAIL_ID)  as WidgetInstance<MarkdownWidgetState> | null;
  if (state.mode === 'results') {
    // Results layout: cards own the top, detail spans the bottom 6
    // rows. Tab toggles which one j/k drives — paint the focused
    // pane with full text, the other with the dim subtext branch.
    if (personas) personas.state.focused = false;
    if (results)  results.state.focused  = false;
    if (detail)   detail.state.focused   = state.resultsFocus === 'detail';
    return;
  }
  if (personas) personas.state.focused = state.focus === 0;
  if (results)  results.state.focused  = state.focus === 2;
  if (detail)   detail.state.focused   = state.focus === 1;
}

/** Push fresh header + detail + results into their widgets. Detail
 *  pane content is driven by `state.focus`:
 *    - focus === 0 (personas) → bio of the row under the list cursor
 *    - focus === 2 (results) → full rationale of the row under the
 *      results-table cursor (or placeholder when no results yet)
 *    - focus === 1 (detail itself) → keep whatever was there last
 *
 *  Call from any handler that mutates state. */
export function refreshWidgets(
  ctx: PluginContext,
  state: ConsensusTraderState,
): void {
  const header = ctx.getWidget(CT_HEADER_ID) as WidgetInstance<MarkdownWidgetState> | null;
  if (header) header.state.text = renderHeader(state);

  const results = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
  if (results) {
    results.state.rows = resultsToTableRows(state.results);
    // Enable the cursor once there are results so keybindings can
    // drive row-level drill-down; clear it back to -1 when the run
    // is reset so the table doesn't highlight a phantom row.
    if (state.results.length > 0 && results.state.cursor < 0) {
      results.state.cursor = 0;
    }
    if (state.results.length === 0) {
      results.state.cursor = -1;
    } else if (results.state.cursor >= state.results.length) {
      results.state.cursor = state.results.length - 1;
    }
  }

  const detail = ctx.getWidget(CT_DETAIL_ID) as WidgetInstance<MarkdownWidgetState> | null;
  if (detail) {
    if (state.focus === 2) {
      const row = results && results.state.cursor >= 0
        ? state.results[results.state.cursor] ?? null
        : null;
      detail.state.text = renderResultDetail(row);
    } else if (state.focus === 1 && (state.aggregatorOutput || state.commonGround)) {
      // Center-column focus: surface the aggregator summary first,
      // fall back to the data-collector brief if no aggregator ran.
      const parts: string[] = [];
      if (state.aggregatorOutput) parts.push(state.aggregatorOutput);
      if (state.commonGround) {
        parts.push(state.aggregatorOutput ? '\n---\n\n### Research brief\n\n' + state.commonGround : '## Research brief\n\n' + state.commonGround);
      }
      detail.state.text = parts.join('\n');
    } else {
      const personas = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
      const focusedItem = personas?.state.items[personas.state.cursor];
      const focused = personaFromItem(focusedItem);
      detail.state.text = renderPersonaDetail(focused?.id ?? null);
    }
  }

  updateFocusFlags(ctx, state);

  // Mirror results[] into the pre-spawned result-card widgets — used
  // by the results-mode layout. Cheap when mode==='picking' since
  // the cells aren't rendered, but kept synced so a later setLayout
  // swap shows the right content without an extra refresh round-trip.
  syncCardStates(ctx, state);
}

// ── Slash commands ──
// withState wraps a handler so every mutation finishes with a widget
// refresh + render request — mirrors the sync plugin pattern.

function withState(
  handler: (state: ConsensusTraderState, args: string[], ctx: PluginContext) => void | Promise<void>,
): SlashCommand['handler'] {
  return async (args, ctx) => {
    const state = ctx.state as ConsensusTraderState;
    if (!state) return;
    await handler(state, args, ctx);
    refreshWidgets(ctx, state);
    ctx.requestRender();
  };
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(n, hi));

/** Read the persona id currently under the list cursor, or null when
 *  the list is empty / out of sync. Items are ANSI-wrapped labels
 *  since we run with preserveAnsi; personaFromItem strips the codes
 *  before lookup. */
function personaAtCursor(ctx: PluginContext): string | null {
  const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
  if (!w) return null;
  const p = personaFromItem(w.state.items[w.state.cursor]);
  return p?.id ?? null;
}

// Public (user-facing, typed at the prompt) slashes are:
//   /ct-run, /ct-cancel, /ct-set-query, /ct-set-count, /ct-set-search,
//   /ct-reload-personas, /ct-back-to-picking, /ct-use-data-collector,
//   /ct-use-aggregator, /ct-help
// Everything else is `hidden: true` — dispatched from keybindings
// only. Keeps the help surface short while letting the framework
// still route key events through the slash-command machinery.

const slashCommands: SlashCommand[] = [
  // ── Cursor movement (focus-aware) ──
  // When focus is on the results table (2) we steer the table cursor
  // so the detail pane drills into each row. Otherwise j/k/g/G move
  // the persona list cursor — same keybinding, different target.
  {
    name: 'ct-move',
    description: '(internal — keybinding j/k/pgdown/pgup) Move the focused cursor by N',
    hidden: true,
    handler: withState((s, args, ctx) => {
      const delta = Number.parseInt(args[0] ?? '0', 10) || 0;
      // Results mode: route through card-cursor unless detail pane has
      // focus, in which case scroll the markdown instead. Cards are the
      // default focus on entry so j/k feels natural after /ct-run.
      if (s.mode === 'results') {
        if (s.resultsFocus === 'detail') {
          const md = ctx.getWidget(CT_DETAIL_ID) as WidgetInstance<{ scroll: number }> | null;
          if (md) md.state.scroll = Math.max(0, md.state.scroll + delta);
          return;
        }
        if (s.results.length === 0) return;
        const n = s.results.length;
        const cur = s.cardCursor < 0 ? 0 : s.cardCursor;
        s.cardCursor = ((cur + delta) % n + n) % n;
        return;
      }
      if (s.focus === 2) {
        const t = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
        if (!t || t.state.rows.length === 0) return;
        t.state.cursor = clamp((t.state.cursor < 0 ? 0 : t.state.cursor) + delta, 0, t.state.rows.length - 1);
      } else {
        const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
        if (!w) return;
        w.state.cursor = clamp(w.state.cursor + delta, 0, Math.max(0, w.state.items.length - 1));
      }
    }),
  },
  {
    name: 'ct-move-home',
    description: '(internal — keybinding g/home) Jump the focused cursor to the first row',
    hidden: true,
    handler: withState((s, _a, ctx) => {
      if (s.focus === 2) {
        const t = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
        if (t && t.state.rows.length > 0) { t.state.cursor = 0; t.state.offset = 0; }
      } else {
        const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
        if (w) { w.state.cursor = 0; w.state.offset = 0; }
      }
    }),
  },
  {
    name: 'ct-move-end',
    description: '(internal — keybinding G/end) Jump the focused cursor to the last row',
    hidden: true,
    handler: withState((s, _a, ctx) => {
      if (s.focus === 2) {
        const t = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
        if (t && t.state.rows.length > 0) t.state.cursor = t.state.rows.length - 1;
      } else {
        const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
        if (w) w.state.cursor = Math.max(0, w.state.items.length - 1);
      }
    }),
  },
  // ── Focus cycling across the three columns ──
  {
    name: 'ct-focus-right',
    description: '(internal — keybinding l/right) Move column focus one step right (no wrap)',
    hidden: true,
    handler: withState(s => { s.focus = clamp(s.focus + 1, 0, 2) as 0 | 1 | 2; }),
  },
  {
    name: 'ct-focus-left',
    description: '(internal — keybinding h/left) Move column focus one step left (no wrap)',
    hidden: true,
    handler: withState(s => { s.focus = clamp(s.focus - 1, 0, 2) as 0 | 1 | 2; }),
  },
  {
    name: 'ct-cycle-focus',
    description: '(internal — keybinding tab) Cycle focus — picking: cycle 3 columns; results: toggle cards ↔ detail',
    hidden: true,
    handler: withState(s => {
      if (s.mode === 'results') {
        s.resultsFocus = s.resultsFocus === 'cards' ? 'detail' : 'cards';
      } else {
        s.focus = ((s.focus + 1) % 3) as 0 | 1 | 2;
      }
    }),
  },
  {
    name: 'ct-cycle-focus-back',
    description: '(internal — keybinding S-tab) Cycle focus backward — same toggle in results mode',
    hidden: true,
    handler: withState(s => {
      if (s.mode === 'results') {
        s.resultsFocus = s.resultsFocus === 'cards' ? 'detail' : 'cards';
      } else {
        s.focus = ((s.focus + 2) % 3) as 0 | 1 | 2;
      }
    }),
  },
  // ── Picking ──
  {
    name: 'ct-toggle',
    description: '(internal — keybinding space) Add/remove the cursor persona from the picked set',
    hidden: true,
    handler: withState((s, _a, ctx) => {
      const id = personaAtCursor(ctx);
      if (!id) return;
      if (s.pickedIds.has(id)) s.pickedIds.delete(id);
      else s.pickedIds.add(id);
      // Auto-advance the cursor for rapid multi-pick.
      const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
      if (w) w.state.cursor = clamp(w.state.cursor + 1, 0, Math.max(0, w.state.items.length - 1));
      syncPersonaListSelection(ctx, s);
    }),
  },
  {
    name: 'ct-clear-picks',
    description: '(internal) Drop every picked persona (see also: ct-clear-and-run)',
    hidden: true,
    handler: withState((s, _a, ctx) => {
      s.pickedIds.clear();
      syncPersonaListSelection(ctx, s);
    }),
  },
  {
    name: 'ct-pick-all',
    description: '(internal — keybinding a) Pick every currently-visible persona (respects search filter)',
    hidden: true,
    handler: withState((s, _a, ctx) => {
      // Picked set grows to include the filtered pool; clears when
      // all filtered entries are already picked (idempotent toggle).
      const visible = filterPersonas(s.searchText);
      const allPicked = visible.every(p => s.pickedIds.has(p.id));
      if (allPicked) {
        for (const p of visible) s.pickedIds.delete(p.id);
      } else {
        for (const p of visible) s.pickedIds.add(p.id);
      }
      syncPersonaListSelection(ctx, s);
    }),
  },
  // ── Query + count ──
  {
    name: 'ct-set-query',
    description: 'Set the question every persona will answer',
    handler: withState((s, args) => {
      s.query = args.join(' ').trim();
    }),
  },
  {
    name: 'ct-set-count',
    description: 'Set the number of agents to run (1..20)',
    handler: withState((s, args, ctx) => {
      const n = Number.parseInt(args[0] ?? '', 10);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        s.actions?.notify?.(`[consensus] agent count must be 1..20 (got "${args[0]}")`);
        return;
      }
      s.agentCount = n;
    }),
  },
  {
    name: 'ct-set-search',
    description: 'Filter the persona pool by free-text search',
    handler: withState((s, args, ctx) => {
      s.searchText = args.join(' ');
      // Reset cursor so the post-filter list doesn't point past its end.
      const w = ctx.getWidget(CT_PERSONAS_ID) as WidgetInstance<ListWidgetState> | null;
      if (w) { w.state.cursor = 0; w.state.offset = 0; }
      syncPersonaListSelection(ctx, s);
    }),
  },
  // ── Run + cancel ──
  {
    name: 'ct-run',
    description: 'Run the configured consensus (auto-samples when nothing picked); pivots to results-mode card grid on success',
    handler: async (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      const notify = s.actions?.notify ?? ((m: string) => ctx.log(m));
      if (s.running) { notify('[consensus] already running'); return; }
      if (!s.query) { notify('[consensus] set a query first (/ct-set-query <text>)'); return; }
      await runConsensus(
        { log: ctx.log, requestRender: () => { refreshWidgets(ctx, s); ctx.requestRender(); } },
        s,
      );
      // Jump focus to the results table + cursor on the first row so
      // the user lands in the drill-down flow immediately after a run.
      s.focus = 2;
      const t = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
      if (t && t.state.rows.length > 0) t.state.cursor = 0;
      // Flip to the card-grid layout and place the grid cursor on the
      // first card so j/k can start drilling in right away.
      s.mode = 'results';
      s.cardCursor = s.results.length > 0 ? 0 : -1;
      s.resultsFocus = 'cards';
      refreshWidgets(ctx, s);
      ctx.setLayout(buildResultsLayout());
      ctx.requestRender();
    },
  },
  {
    name: 'ct-cancel',
    description: 'Leave the plugin',
    handler: (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      s.actions?.exit?.();
    },
  },
  {
    name: 'ct-back-to-picking',
    description: 'Return to the picking layout (persona list + detail + results table) from the results card grid',
    handler: withState((s, _a, ctx) => {
      if (s.mode === 'picking') return;
      s.mode = 'picking';
      s.cardCursor = -1;
      ctx.setLayout(buildPickingLayout());
    }),
  },
  {
    name: 'ct-move-card',
    description: '(internal — keybinding j/k in results mode) Move the card grid cursor by N; wraps at boundaries',
    hidden: true,
    handler: withState((s, args) => {
      if (s.mode !== 'results' || s.results.length === 0) return;
      const delta = Number.parseInt(args[0] ?? '0', 10) || 0;
      const n = s.results.length;
      const cur = s.cardCursor < 0 ? 0 : s.cardCursor;
      s.cardCursor = ((cur + delta) % n + n) % n;
    }),
  },
  {
    name: 'ct-clear-and-run',
    description: '(internal — keybinding c) Drop every picked persona then run auto-sample',
    hidden: true,
    handler: async (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      s.pickedIds.clear();
      syncPersonaListSelection(ctx, s);
      refreshWidgets(ctx, s);
      ctx.requestRender();
      // Dispatch ct-run's handler inline — same query/count, now
      // running in auto mode because pickedIds is empty.
      const runCmd = slashCommands.find(c => c.name === 'ct-run');
      if (runCmd) await runCmd.handler([], ctx);
    },
  },
  {
    name: 'ct-help',
    description: 'Print the consensus-trader keybindings + public slash commands to the log',
    handler: async (_args, ctx) => {
      const public_ = (plugin.slashCommands ?? [])
        .filter(c => !c.hidden)
        .map(c => `  ${C.key('/' + c.name)}  ${C.muted(c.description)}`);
      const kbs = (plugin.keybindings ?? [])
        .map(kb => `  ${C.key(kb.key.padEnd(7))}  ${C.muted('→ /' + kb.command)}`);
      ctx.log(`${C.bold('consensus-trader — public commands')}`);
      for (const l of public_) ctx.log(l);
      ctx.log(`${C.bold('consensus-trader — keybindings')}`);
      for (const l of kbs) ctx.log(l);
    },
  },
  {
    name: 'ct-reload-personas',
    description: 'Re-read builtin + ~/.claude/consensus-trader/personas.json from disk and rebuild the persona list',
    handler: withState((s, _a, ctx) => {
      const summary = reloadPersonas();
      syncPersonaListSelection(ctx, s);
      // Any previously-picked personas that got removed by the reload
      // drop off the picked set implicitly — syncPersonaListSelection
      // already filters by the fresh PERSONAS pool. Report via log.
      const removed = summary.removed.filter(id => s.pickedIds.has(id));
      for (const id of removed) s.pickedIds.delete(id);
      const parts = [
        `total=${summary.total}`,
        `user=${summary.userCount}`,
        summary.added.length ? `+${summary.added.length}` : '',
        summary.removed.length ? `−${summary.removed.length}` : '',
      ].filter(Boolean).join(' · ');
      s.actions?.notify?.(`[consensus] personas reloaded (${parts})`);
      ctx.log(`[consensus] personas reloaded: ${parts}`);
      if (summary.userError) {
        ctx.log(`[consensus] user persona file error: ${summary.userError} (${USER_PATH})`);
      }
    }),
  },
  // ── Phase D toggles ──
  {
    name: 'ct-use-data-collector',
    description: 'Toggle the Phase-D Data Collector pre-run (seeds commonGround)',
    handler: withState((s) => {
      s.useDataCollector = !s.useDataCollector;
      s.actions?.notify?.(`[consensus] data-collector ${s.useDataCollector ? 'ON' : 'OFF'}`);
    }),
  },
  {
    name: 'ct-use-aggregator',
    description: 'Toggle the Phase-D Aggregator post-run (fills aggregatorOutput)',
    handler: withState((s) => {
      s.useAggregator = !s.useAggregator;
      s.actions?.notify?.(`[consensus] aggregator ${s.useAggregator ? 'ON' : 'OFF'}`);
    }),
  },
];

// ── Keybindings ──
// Mirror the sync plugin shape — plugin-host resolves these against
// slashCommands by name. Focused columns handle `space` / `a` via the
// picker commands so the list widget's native toggle never fires.

const keybindings: Keybinding[] = [
  // Cursor movement — `ct-move` is focus-aware (personas list vs.
  // results table). In results-mode the card grid has its own
  // cursor; we overload j/k there via `ct-move-card` which is a
  // no-op when mode='picking' so the binding safely stays installed.
  { key: 'j',        command: 'ct-move 1' },
  { key: 'down',     command: 'ct-move 1' },
  { key: 'k',        command: 'ct-move -1' },
  { key: 'up',       command: 'ct-move -1' },
  { key: 'g',        command: 'ct-move-home' },
  { key: 'home',     command: 'ct-move-home' },
  { key: 'S-g',      command: 'ct-move-end' },
  { key: 'end',      command: 'ct-move-end' },
  { key: 'pagedown', command: 'ct-move 10' },
  { key: 'pageup',   command: 'ct-move -10' },
  // Column focus — tab cycles in picking mode; kept as-is.
  { key: 'tab',   command: 'ct-cycle-focus' },
  { key: 'S-tab', command: 'ct-cycle-focus-back' },
  { key: 'l',     command: 'ct-focus-right' },
  { key: 'right', command: 'ct-focus-right' },
  { key: 'h',     command: 'ct-focus-left' },
  { key: 'left',  command: 'ct-focus-left' },
  // Picking
  { key: 'space', command: 'ct-toggle' },
  { key: 'a',     command: 'ct-pick-all' },
  // `c` = canonical "clear picks + re-run in auto mode" per UX spec
  // (replaces the prior bare `ct-clear-picks`; users who want just
  // clear-without-run can still invoke `/ct-clear-picks`).
  { key: 'c',     command: 'ct-clear-and-run' },
  // Reload custom personas (merges ~/.claude/consensus-trader/personas.json).
  { key: 'S-r',   command: 'ct-reload-personas' },
  // Return to picking layout from the results card grid.
  { key: 'b',     command: 'ct-back-to-picking' },
  // Run / leave
  { key: 'enter', command: 'ct-run' },
  { key: 'q',      command: 'ct-cancel' },
  { key: 'escape', command: 'ct-cancel' },
];

// ── LLM tools ──
// Read-only tools + a few mutators so the chat model can drive the
// plugin end-to-end. The dashboard chat loop forwards these to the
// active plugin so users can say "pick 3 value investors and ask
// about 삼성전자 2026" and the model arranges state + fires the run.

const llmTools: LLMToolDef[] = [
  {
    name: 'consensus.listPersonas',
    description: 'List every persona in the pool. Optional filter is a case-insensitive substring match against id, name, role, style, or domain.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring filter' },
      },
    },
    handler: async (args) => {
      const filter = typeof args.filter === 'string' ? args.filter : '';
      const rows = filterPersonas(filter);
      return {
        total: PERSONAS.length,
        matched: rows.length,
        personas: rows.map(p => ({
          id: p.id,
          name: p.name,
          role: p.role,
          style: p.style,
          domains: p.domains,
        })),
      };
    },
  },
  {
    name: 'consensus.getState',
    description: 'Return the current query, picked personas, agent count, running flag, and any existing results.',
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      return {
        query: s.query,
        searchText: s.searchText,
        pickedIds: [...s.pickedIds],
        agentCount: s.agentCount,
        running: s.running,
        resultCount: s.results.length,
      };
    },
  },
  {
    name: 'consensus.pickPersonas',
    description: 'Replace the picked set with the given persona ids. Unknown ids are ignored and reported.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Persona ids to pick (see consensus.listPersonas for valid ids).',
        },
      },
      required: ['ids'],
    },
    handler: async (args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).filter(x => typeof x === 'string') as string[] : [];
      const known = ids.filter(id => getPersona(id));
      const unknown = ids.filter(id => !getPersona(id));
      s.pickedIds = new Set(known);
      syncPersonaListSelection(ctx, s);
      refreshWidgets(ctx, s);
      ctx.requestRender();
      return { picked: known, unknown };
    },
  },
  {
    name: 'consensus.setQuery',
    description: 'Set the question every persona will answer on the next run.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      s.query = typeof args.query === 'string' ? args.query : '';
      refreshWidgets(ctx, s);
      ctx.requestRender();
      return { query: s.query };
    },
  },
  {
    name: 'consensus.setAgentCount',
    description: 'Set the maximum number of agents to run (1..20).',
    parameters: {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 1, maximum: 20 } },
      required: ['count'],
    },
    handler: async (args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      const n = typeof args.count === 'number' ? Math.floor(args.count) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return { ok: false, error: `count must be 1..20, got ${JSON.stringify(args.count)}` };
      }
      s.agentCount = n;
      refreshWidgets(ctx, s);
      ctx.requestRender();
      return { ok: true, agentCount: n };
    },
  },
  {
    name: 'consensus.runAnalysis',
    description: 'Run the consensus against the current query. When no personas are picked it auto-samples agentCount random personas from the (filtered) pool. Rejects when query is empty or a run is already in flight. Returns a summary once every agent settles.',
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      if (s.running) return { ok: false, error: 'already running' };
      if (!s.query.trim()) return { ok: false, error: 'query is empty' };
      await runConsensus(
        { log: ctx.log, requestRender: () => { refreshWidgets(ctx, s); ctx.requestRender(); } },
        s,
      );
      s.focus = 2;
      const t = ctx.getWidget(CT_RESULTS_ID) as WidgetInstance<TableState> | null;
      if (t && t.state.rows.length > 0) t.state.cursor = 0;
      refreshWidgets(ctx, s);
      ctx.requestRender();
      return {
        ok: true,
        mode: s.pickedIds.size > 0 ? 'picked' : 'auto',
        results: s.results.map(r => ({
          personaId: r.personaId,
          personaName: r.personaName,
          stance: r.stance,
          confidence: r.confidence,
          summary: r.summary,
          error: r.error,
        })),
      };
    },
  },
  {
    name: 'consensus.getResults',
    description: 'Return the result rows from the most recent run.',
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const s = ctx.state as ConsensusTraderState;
      return {
        results: s.results.map(r => ({
          personaId: r.personaId,
          personaName: r.personaName,
          stance: r.stance,
          confidence: r.confidence,
          summary: r.summary,
          error: r.error,
        })),
      };
    },
  },
];

// ── Plugin default export ──

const plugin: ElanousPlugin<ConsensusTraderState> = {
  name: 'consensus-trader',
  version: '0.3.0',
  description: 'Multi-persona consensus — pick N experts, pose a question, aggregate stances',

  initialState(): ConsensusTraderState {
    return {
      query: '',
      searchText: '',
      pickedIds: new Set(),
      agentCount: 5,
      running: false,
      results: [],
      // Start focus on the persona pane so it gets the bright cursor
      // color on first render — users pressing Tab immediately land
      // on the detail pane, then results on the second Tab.
      focus: 0,
      // Phase 5.2 mode machine: start in picking (classic 3-column)
      // layout; /ct-run flips to 'results' (card grid). Card cursor
      // is -1 until a run populates the grid.
      mode: 'picking',
      cardCursor: -1,
      resultsFocus: 'cards',
      // Phase D flags default OFF so existing flows are unchanged.
      // /ct-use-data-collector and /ct-use-aggregator flip them on.
      useDataCollector: false,
      useAggregator: false,
      commonGround: '',
      aggregatorOutput: '',
    };
  },

  isBusy(state) {
    return state.running;
  },

  requiredWidgets: ['list', 'markdown', 'table', 'result-card'],
  panes: {},
  slashCommands,
  keybindings,
  llmTools,
  buildLayout,

  async onActivate(ctx) {
    const userNote = USER_PERSONA_COUNT > 0
      ? ` (+${USER_PERSONA_COUNT} user-defined)` : '';
    ctx.log(`[consensus-trader] ${PERSONAS.length} personas loaded${userNote} — /ct-set-query <text> then Enter (auto-samples ${(ctx.state as ConsensusTraderState).agentCount} agents)`);
    if (USER_PERSONA_ERROR) {
      ctx.log(`[consensus-trader] user persona file error: ${USER_PERSONA_ERROR} (${USER_PATH})`);
    }
    if (USER_PERSONA_COUNT === 0) {
      ctx.log(`[consensus-trader] add custom personas at ${USER_PATH} (same schema as the built-in pool)`);
    }
  },

  async onDeactivate(ctx) {
    ctx.log('[consensus-trader] left');
  },
};

export default plugin;
export type { Persona };
