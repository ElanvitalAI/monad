// ── Sync plugin — dogfood plugin #1 ──
// W4.3 migration: state that was previously owned by SyncPluginState
// (cursors / offsets / selected / lists) now lives on list-widget
// instances spawned by buildLayout. The plugin state itself is just
// mode + focus + busy + actions bridge back to dashboard.

import type {
  MonadPlugin, SlashCommand, Keybinding, LLMToolDef, PluginLayoutCtx, PluginContext,
} from '../../src/plugins/core/types.js';
import type { WidgetInstance } from '../../src/widgets/types.js';
import type { Layout } from '../../src/layout/types.js';
import type { ListWidgetState } from '../../widgets/list/widget.js';
import type { MarkdownWidgetState } from '../../widgets/markdown/widget.js';
import { createLayout } from '../../src/layout/host.js';
import { C } from '../../src/tui.js';
import { syncServers, SERVICE_NAMES } from '../../src/config.js';
import { SYNC_MODES } from './types.js';

// Fixed widget instance ids — plugin handlers look them up by name
// instead of tracking ids on state. Keeps resume / re-activate simple.
export const SYNC_WIDGET_IDS = ['sync-skills', 'sync-servers', 'sync-services'] as const;
export const SYNC_HEADER_ID = 'sync-header';

export interface SyncPluginState {
  /** Which of the 3 list widgets currently has focus. */
  focus: 0 | 1 | 2;
  /** Index into SYNC_MODES (clean / merge / smart / diff). */
  modeIdx: number;
  /** Long-running sync / diff is executing — host blocks input. */
  busy: boolean;
  /** Local skill names (without the '* ALL' pseudo-item). Cached on
   *  the plugin so sync-toggle + select-all logic can find the real
   *  skill list without asking dashboard on every keystroke. */
  allSkillNames: string[];
  /** Dashboard-owned operations the plugin invokes from slash handlers.
   *  Set by dashboard after plugin.onActivate returns. */
  actions?: SyncActions;
}

export interface SyncActions {
  /** Run sync/diff with the given selection + mode id. */
  confirm(skills: string[], servers: string[], services: string[], modeId: string): Promise<void>;
  /** Leave sync mode (plugin-host deactivate). */
  exit(): void;
  /** Surface a one-line message in the log pane. */
  notify(msg: string): void;
  /** Dashboard refreshes allSkillNames and writes it back into the
   *  skills widget + plugin state. */
  markListsDirty(): void;
}

// D2 regression guard: post-run cleanup. Called by dashboard after
// runSyncInline / runDiffInline completes. Clears skill + server
// selections on the widgets, leaves services intact, rewinds cursors,
// and flips busy off.
export function resetAfterRun(
  state: SyncPluginState,
  widgets: {
    skills: WidgetInstance<ListWidgetState> | null;
    servers: WidgetInstance<ListWidgetState> | null;
    services: WidgetInstance<ListWidgetState> | null;
  },
): SyncPluginState {
  if (widgets.skills) {
    widgets.skills.state.selected.clear();
    widgets.skills.state.cursor = 0;
    widgets.skills.state.offset = 0;
  }
  if (widgets.servers) {
    widgets.servers.state.selected.clear();
    widgets.servers.state.cursor = 0;
    widgets.servers.state.offset = 0;
  }
  if (widgets.services) {
    widgets.services.state.cursor = 0;
    widgets.services.state.offset = 0;
  }
  return {
    focus: 0,
    modeIdx: state.modeIdx,
    busy: false,
    allSkillNames: state.allSkillNames,
    actions: state.actions,
  };
}

// ── Helpers ─────────────────────────────────────────────

function focusedList(ctx: PluginContext, state: SyncPluginState): WidgetInstance<ListWidgetState> | null {
  return (ctx.getWidget(SYNC_WIDGET_IDS[state.focus]) as WidgetInstance<ListWidgetState> | null) ?? null;
}

function updateHeaderText(ctx: PluginContext, state: SyncPluginState): void {
  const header = ctx.getWidget(SYNC_HEADER_ID) as WidgetInstance<MarkdownWidgetState> | null;
  if (!header) return;
  const parts = SYNC_MODES.map((m, i) =>
    i === state.modeIdx
      ? m.color(`${m.symbol} ${m.label.toLowerCase()} on`)
      : C.muted(`${i + 1}:${m.label}`),
  ).join(C.dim(' \u2502 '));
  header.state.text = `${C.highlight('sync')}  ${parts}`;
}

function updateFocusFlags(ctx: PluginContext, state: SyncPluginState): void {
  for (let i = 0; i < SYNC_WIDGET_IDS.length; i++) {
    const w = ctx.getWidget(SYNC_WIDGET_IDS[i]!) as WidgetInstance<ListWidgetState> | null;
    if (w) w.state.focused = i === state.focus;
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, hi));

function withState(handler: (state: SyncPluginState, args: string[], ctx: PluginContext) => void | Promise<void>): SlashCommand['handler'] {
  return async (args, ctx) => {
    const state = ctx.state as SyncPluginState;
    if (!state) return;
    await handler(state, args, ctx);
    updateHeaderText(ctx, state);
    updateFocusFlags(ctx, state);
    ctx.requestRender();
  };
}

// ── Slash commands ──────────────────────────────────────

const slashCommands: SlashCommand[] = [
  {
    name: 'sync-set-mode',
    description: 'Set SYNC_MODES index (0..3)',
    handler: withState((s, args) => {
      const idx = Number.parseInt(args[0] ?? '', 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < SYNC_MODES.length) s.modeIdx = idx;
    }),
  },
  {
    name: 'sync-cycle-mode',
    description: 'Advance SYNC_MODES to the next entry',
    handler: withState((s) => { s.modeIdx = (s.modeIdx + 1) % SYNC_MODES.length; }),
  },
  {
    name: 'sync-cycle-focus',
    description: 'Move focus right across the three sync widgets (wraps)',
    handler: withState((s) => { s.focus = ((s.focus + 1) % 3) as 0 | 1 | 2; }),
  },
  {
    name: 'sync-cycle-focus-back',
    description: 'Move focus left across the three sync widgets (wraps)',
    handler: withState((s) => { s.focus = ((s.focus + 2) % 3) as 0 | 1 | 2; }),
  },
  {
    name: 'sync-focus-left',
    description: 'Move focus one widget left (no wrap)',
    handler: withState((s) => { s.focus = Math.max(s.focus - 1, 0) as 0 | 1 | 2; }),
  },
  {
    name: 'sync-focus-right',
    description: 'Move focus one widget right (no wrap)',
    handler: withState((s) => { s.focus = Math.min(s.focus + 1, 2) as 0 | 1 | 2; }),
  },
  {
    name: 'sync-move',
    description: 'Move the focused widget cursor by N',
    handler: withState((s, args, ctx) => {
      const w = focusedList(ctx, s);
      if (!w) return;
      const delta = Number.parseInt(args[0] ?? '0', 10) || 0;
      w.state.cursor = clamp(w.state.cursor + delta, 0, Math.max(0, w.state.items.length - 1));
    }),
  },
  {
    name: 'sync-move-home',
    description: 'Reset cursor + offset of the focused widget',
    handler: withState((s, _a, ctx) => {
      const w = focusedList(ctx, s);
      if (!w) return;
      w.state.cursor = 0;
      w.state.offset = 0;
    }),
  },
  {
    name: 'sync-move-end',
    description: 'Move cursor to last item of focused widget',
    handler: withState((s, _a, ctx) => {
      const w = focusedList(ctx, s);
      if (!w) return;
      w.state.cursor = Math.max(0, w.state.items.length - 1);
    }),
  },
  {
    name: 'sync-toggle',
    description: 'Toggle selection at cursor, auto-advance',
    handler: withState((s, _a, ctx) => {
      const w = focusedList(ctx, s);
      if (!w) return;
      const name = w.state.items[w.state.cursor];
      if (!name) return;
      // '* ALL' pseudo-item — applies to whichever pane is focused.
      // Real items are everything else on that widget (or allSkillNames
      // on the skills pane, which has richer bookkeeping).
      if (name === '* ALL') {
        const real = s.focus === 0
          ? s.allSkillNames
          : w.state.items.filter(n => n !== '* ALL');
        if (w.state.selected.size === real.length) w.state.selected.clear();
        else real.forEach((x: string) => w.state.selected.add(x));
      } else {
        w.state.selected.has(name) ? w.state.selected.delete(name) : w.state.selected.add(name);
      }
      w.state.cursor = clamp(w.state.cursor + 1, 0, Math.max(0, w.state.items.length - 1));
    }),
  },
  {
    name: 'sync-toggle-all',
    description: 'Select-all / clear-all in the focused widget',
    handler: withState((s, _a, ctx) => {
      const w = focusedList(ctx, s);
      if (!w) return;
      const real = s.focus === 0
        ? s.allSkillNames
        : w.state.items.filter(n => n !== '* ALL');
      if (w.state.selected.size === real.length) w.state.selected.clear();
      else real.forEach((x: string) => w.state.selected.add(x));
    }),
  },
  {
    name: 'sync-confirm',
    description: 'Run sync/diff over current selection if complete',
    handler: async (_args, ctx) => {
      const s = ctx.state as SyncPluginState;
      const skills = ctx.getWidget(SYNC_WIDGET_IDS[0]) as WidgetInstance<ListWidgetState> | null;
      const servers = ctx.getWidget(SYNC_WIDGET_IDS[1]) as WidgetInstance<ListWidgetState> | null;
      const services = ctx.getWidget(SYNC_WIDGET_IDS[2]) as WidgetInstance<ListWidgetState> | null;
      const sk = skills?.state.selected.size ?? 0;
      const sv = servers?.state.selected.size ?? 0;
      const vc = services?.state.selected.size ?? 0;
      if (sk > 0 && sv > 0 && vc > 0) {
        await s.actions?.confirm(
          [...skills!.state.selected],
          [...servers!.state.selected],
          [...services!.state.selected],
          SYNC_MODES[s.modeIdx]!.id,
        );
      } else {
        const missing: string[] = [];
        if (!sk) missing.push('skills');
        if (!sv) missing.push('servers');
        if (!vc) missing.push('services');
        s.actions?.notify(`Select ${missing.join(', ')} first`);
      }
      ctx.requestRender();
    },
  },
  {
    name: 'sync-cancel',
    description: 'Leave sync mode',
    handler: (_args, ctx) => {
      const s = ctx.state as SyncPluginState;
      s.actions?.exit();
      s.actions?.notify('Sync cancelled');
    },
  },
];

const keybindings: Keybinding[] = [
  // Mode selection: 1/2/3/4 only. Shift+Tab was removed per user
  // feedback — Tab direction should be consistent (focus cycle only).
  { key: '1',     command: 'sync-set-mode 0' },
  { key: '2',     command: 'sync-set-mode 1' },
  { key: '3',     command: 'sync-set-mode 2' },
  { key: '4',     command: 'sync-set-mode 3' },
  // Focus cycle: Tab forward, Shift+Tab backward (consistency).
  { key: 'tab',   command: 'sync-cycle-focus' },
  { key: 'S-tab', command: 'sync-cycle-focus-back' },
  { key: 'l',     command: 'sync-focus-right' },
  { key: 'right', command: 'sync-focus-right' },
  { key: 'h',     command: 'sync-focus-left' },
  { key: 'left',  command: 'sync-focus-left' },
  { key: 'j',       command: 'sync-move 1' },
  { key: 'down',    command: 'sync-move 1' },
  { key: 'k',       command: 'sync-move -1' },
  { key: 'up',      command: 'sync-move -1' },
  { key: 'g',       command: 'sync-move-home' },
  { key: 'home',    command: 'sync-move-home' },
  { key: 'S-g',     command: 'sync-move-end' },
  { key: 'end',     command: 'sync-move-end' },
  { key: 'pagedown', command: 'sync-move 10' },
  { key: 'pageup',   command: 'sync-move -10' },
  { key: 'space', command: 'sync-toggle' },
  { key: '*',     command: 'sync-toggle' },
  { key: 'a',     command: 'sync-toggle-all' },
  { key: 'enter', command: 'sync-confirm' },
  { key: 'q',      command: 'sync-cancel' },
  { key: 'escape', command: 'sync-cancel' },
];

// ── LLM tools ───────────────────────────────────────────

const llmTools: LLMToolDef[] = [
  {
    name: 'sync.getState',
    description: 'Return the current sync selection and mode. Use when the user asks what is currently selected.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async (_args, ctx) => {
      const s = ctx.state as SyncPluginState;
      const skills = ctx.getWidget(SYNC_WIDGET_IDS[0]) as WidgetInstance<ListWidgetState> | null;
      const servers = ctx.getWidget(SYNC_WIDGET_IDS[1]) as WidgetInstance<ListWidgetState> | null;
      const services = ctx.getWidget(SYNC_WIDGET_IDS[2]) as WidgetInstance<ListWidgetState> | null;
      if (!skills || !servers || !services) return { active: false };
      return {
        active: true,
        skills: [...skills.state.selected],
        servers: [...servers.state.selected],
        services: [...services.state.selected],
        modeIdx: s.modeIdx,
        mode: SYNC_MODES[s.modeIdx]?.id ?? 'unknown',
        focus: s.focus,
        busy: s.busy,
      };
    },
  },
  {
    name: 'sync.listAvailable',
    description: 'List all skills, servers, and services the user can select.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async (_args, ctx) => {
      const s = ctx.state as SyncPluginState;
      const servers = ctx.getWidget(SYNC_WIDGET_IDS[1]) as WidgetInstance<ListWidgetState> | null;
      const services = ctx.getWidget(SYNC_WIDGET_IDS[2]) as WidgetInstance<ListWidgetState> | null;
      return {
        active: true,
        skills: [...s.allSkillNames],
        servers: servers ? [...servers.state.items] : [],
        services: services ? [...services.state.items] : [],
      };
    },
  },
];

// ── buildLayout ─────────────────────────────────────────

function buildLayout(ctx: PluginLayoutCtx<SyncPluginState>): Layout {
  // Header widget
  ctx.spawnWidget({
    type: 'markdown',
    id: SYNC_HEADER_ID,
    character: '',
    config: { text: '' },
  });

  // Three list widgets. Items populated by dashboard via syncActions
  // right after activate (skills needs local fs scan; servers/services
  // are static from config but the dashboard can override).
  ctx.spawnWidget({
    type: 'list',
    id: SYNC_WIDGET_IDS[0],
    character: 'Skills',
    config: { items: ['* ALL', ...ctx.state.allSkillNames] },
  });
  ctx.spawnWidget({
    type: 'list',
    id: SYNC_WIDGET_IDS[1],
    character: 'Servers',
    config: { items: syncServers() },
  });
  ctx.spawnWidget({
    type: 'list',
    id: SYNC_WIDGET_IDS[2],
    character: 'Services',
    config: { items: [...SERVICE_NAMES] },
  });

  // Initial focus highlight + header text
  updateFocusFlags(ctx.plugin, ctx.state);
  updateHeaderText(ctx.plugin, ctx.state);

  return createLayout([
    { height: 1, cells: [{ widgetInstanceId: SYNC_HEADER_ID, width: 'flex' }] },
    { height: 'flex', cells: [
      { widgetInstanceId: SYNC_WIDGET_IDS[0], width: 0.33 },
      { widgetInstanceId: SYNC_WIDGET_IDS[1], width: 0.33 },
      { widgetInstanceId: SYNC_WIDGET_IDS[2], width: 'flex' },
    ]},
  ]);
}

const plugin: MonadPlugin<SyncPluginState> = {
  name: 'sync',
  version: '0.3.0',
  description: 'Rsync skills to local or remote servers — pick targets, pick mode, run',

  initialState(): SyncPluginState {
    return {
      focus: 0,
      modeIdx: 2,
      busy: false,
      allSkillNames: [],
    };
  },

  isBusy(state) {
    return state.busy;
  },

  requiredWidgets: ['list', 'markdown'],
  slashCommands,
  keybindings,
  llmTools,
  buildLayout,

  panes: {},

  async onActivate(ctx) {
    ctx.log('[sync] mode engaged — pick skills, servers, services, then Enter');
  },

  async onDeactivate(ctx) {
    ctx.log('[sync] mode left');
  },
};

export default plugin;
