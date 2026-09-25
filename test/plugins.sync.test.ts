// ── Sync plugin smoke tests ──
// Minimum assertions for the dogfood plugin: shape, state defaults,
// slash handlers through the widget bridge, llmTool output.

import { describe, test, expect } from 'bun:test';
import syncPlugin, { resetAfterRun, SYNC_WIDGET_IDS, type SyncPluginState, type SyncActions } from '../plugins/sync/plugin.js';
import { renderSyncCell } from '../plugins/sync/render.js';
import { SYNC_MODES } from '../plugins/sync/types.js';
import listWidget, { type ListWidgetState } from '../widgets/list/widget.js';
import markdownWidget, { type MarkdownWidgetState } from '../widgets/markdown/widget.js';
import type { WidgetInstance } from '../src/widgets/types.js';

// ── Test fixture: fake WidgetHost that hosts list + markdown widgets ──

function makeFakeHost() {
  const instances = new Map<string, WidgetInstance>();
  const spawn = (type: string, id: string) => {
    const def = type === 'list' ? listWidget : markdownWidget;
    const inst: WidgetInstance = {
      id, type, character: id,
      state: (def.initialState as any)(),
    };
    instances.set(id, inst);
    return inst;
  };
  return {
    instances,
    spawn,
    get: (id: string) => instances.get(id) ?? null,
  };
}

function makeCtx(state: SyncPluginState, host: ReturnType<typeof makeFakeHost>) {
  return {
    pluginName: 'sync',
    state,
    setState: () => {},
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: (id: string) => host.get(id),
  };
}

function setupActiveSync(): {
  state: SyncPluginState;
  host: ReturnType<typeof makeFakeHost>;
  ctx: ReturnType<typeof makeCtx>;
  skills: WidgetInstance<ListWidgetState>;
  servers: WidgetInstance<ListWidgetState>;
  services: WidgetInstance<ListWidgetState>;
  header: WidgetInstance<MarkdownWidgetState>;
} {
  const state = syncPlugin.initialState();
  state.allSkillNames = ['skillA', 'skillB', 'skillC'];
  const host = makeFakeHost();
  const skills = host.spawn('list', SYNC_WIDGET_IDS[0]) as WidgetInstance<ListWidgetState>;
  skills.state.items = ['* ALL', ...state.allSkillNames];
  const servers = host.spawn('list', SYNC_WIDGET_IDS[1]) as WidgetInstance<ListWidgetState>;
  servers.state.items = ['srv1', 'srv2'];
  const services = host.spawn('list', SYNC_WIDGET_IDS[2]) as WidgetInstance<ListWidgetState>;
  services.state.items = ['claude', 'cursor'];
  const header = host.spawn('markdown', 'sync-header') as WidgetInstance<MarkdownWidgetState>;
  const ctx = makeCtx(state, host);
  return { state, host, ctx, skills, servers, services, header };
}

// ── Manifest ─────────────────────────────────────────────

describe('sync plugin manifest', () => {
  test('declares required MonadPlugin fields', () => {
    expect(syncPlugin.name).toBe('sync');
    expect(syncPlugin.version).toBeTruthy();
    expect(syncPlugin.description.toLowerCase()).toContain('rsync');
    expect(typeof syncPlugin.initialState).toBe('function');
    expect(syncPlugin.panes).toBeDefined();
  });

  test('initialState has the post-W4.3 shape (no cursors/selected/lists)', () => {
    const state = syncPlugin.initialState();
    expect(state.modeIdx).toBe(2);
    expect(state.focus).toBe(0);
    expect(state.busy).toBe(false);
    expect(state.allSkillNames).toEqual([]);
    // These are gone from state and live on list widgets now:
    expect((state as any).cursors).toBeUndefined();
    expect((state as any).selected).toBeUndefined();
    expect((state as any).lists).toBeUndefined();
  });

  test('isBusy reflects busy flag', () => {
    const state = syncPlugin.initialState();
    expect(syncPlugin.isBusy!(state)).toBe(false);
    state.busy = true;
    expect(syncPlugin.isBusy!(state)).toBe(true);
  });

  test('requiredWidgets lists list + markdown', () => {
    expect(syncPlugin.requiredWidgets).toEqual(['list', 'markdown']);
  });
});

describe('SYNC_MODES', () => {
  test('has four modes in known order', () => {
    expect(SYNC_MODES.map(m => m.id)).toEqual(['clean', 'merge', 'smart', 'diff']);
  });
});

// ── Slash commands (state + widget bridge) ──────────────

describe('sync slash commands', () => {
  const findCmd = (name: string) => syncPlugin.slashCommands!.find(c => c.name === name)!;

  test('sync-set-mode writes modeIdx', async () => {
    const { state, ctx } = setupActiveSync();
    await findCmd('sync-set-mode').handler(['0'], ctx);
    expect(state.modeIdx).toBe(0);
  });

  test('sync-cycle-mode wraps', async () => {
    const { state, ctx } = setupActiveSync();
    state.modeIdx = 3;
    await findCmd('sync-cycle-mode').handler([], ctx);
    expect(state.modeIdx).toBe(0);
  });

  test('sync-cycle-focus rotates 0 → 1 → 2 → 0', async () => {
    const { state, ctx } = setupActiveSync();
    await findCmd('sync-cycle-focus').handler([], ctx);
    expect(state.focus).toBe(1);
    await findCmd('sync-cycle-focus').handler([], ctx);
    expect(state.focus).toBe(2);
    await findCmd('sync-cycle-focus').handler([], ctx);
    expect(state.focus).toBe(0);
  });

  test('sync-move advances focused widget cursor', async () => {
    const { ctx, skills } = setupActiveSync();
    await findCmd('sync-move').handler(['1'], ctx);
    expect(skills.state.cursor).toBe(1);
  });

  test('sync-toggle on * ALL selects every skill', async () => {
    const { state, ctx, skills } = setupActiveSync();
    skills.state.cursor = 0;  // * ALL
    await findCmd('sync-toggle').handler([], ctx);
    expect(skills.state.selected.size).toBe(state.allSkillNames.length);
  });

  test('sync-toggle on a regular item toggles just that name', async () => {
    const { ctx, skills } = setupActiveSync();
    skills.state.cursor = 1;  // skillA
    await findCmd('sync-toggle').handler([], ctx);
    expect([...skills.state.selected]).toEqual(['skillA']);
  });

  test('sync-toggle-all on skills selects every real skill (ignores * ALL)', async () => {
    const { ctx, skills, state } = setupActiveSync();
    await findCmd('sync-toggle-all').handler([], ctx);
    expect(skills.state.selected.size).toBe(state.allSkillNames.length);
  });

  test('sync-confirm with full selection calls actions.confirm with args', async () => {
    const { state, ctx, skills, servers, services } = setupActiveSync();
    skills.state.selected.add('skillA');
    servers.state.selected.add('srv1');
    services.state.selected.add('claude');
    state.modeIdx = 0;  // clean
    const calls: any[] = [];
    state.actions = {
      confirm: async (sk, sv, vc, id) => { calls.push({ sk, sv, vc, id }); },
      exit: () => {}, notify: () => {}, markListsDirty: () => {},
    };
    await findCmd('sync-confirm').handler([], ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].sk).toEqual(['skillA']);
    expect(calls[0].sv).toEqual(['srv1']);
    expect(calls[0].vc).toEqual(['claude']);
    expect(calls[0].id).toBe('clean');
  });

  test('sync-confirm with missing selection notifies, does not call confirm', async () => {
    const { state, ctx } = setupActiveSync();
    const notifies: string[] = [];
    let confirmCalled = false;
    state.actions = {
      confirm: async () => { confirmCalled = true; },
      exit: () => {}, notify: m => notifies.push(m), markListsDirty: () => {},
    };
    await findCmd('sync-confirm').handler([], ctx);
    expect(confirmCalled).toBe(false);
    expect(notifies[0]).toContain('Select');
  });

  test('sync-cancel triggers actions.exit', async () => {
    const { state, ctx } = setupActiveSync();
    let exited = false;
    state.actions = {
      confirm: async () => {}, exit: () => { exited = true; },
      notify: () => {}, markListsDirty: () => {},
    };
    await findCmd('sync-cancel').handler([], ctx);
    expect(exited).toBe(true);
  });
});

// ── resetAfterRun (D2 regression guard) ─────────────────

describe('resetAfterRun', () => {
  test('clears skill + server selections, keeps services', () => {
    const { state, skills, servers, services } = setupActiveSync();
    skills.state.selected.add('skillA');
    servers.state.selected.add('srv1');
    services.state.selected.add('claude');
    services.state.selected.add('cursor');
    const next = resetAfterRun(state, { skills, servers, services });
    expect(skills.state.selected.size).toBe(0);
    expect(servers.state.selected.size).toBe(0);
    expect(services.state.selected.size).toBe(2);  // untouched
    expect(next.busy).toBe(false);
    expect(next.focus).toBe(0);
  });

  test('rewinds cursors + offsets on the widgets', () => {
    const { state, skills, servers, services } = setupActiveSync();
    skills.state.cursor = 5; skills.state.offset = 3;
    servers.state.cursor = 2; services.state.cursor = 1;
    resetAfterRun(state, { skills, servers, services });
    expect(skills.state.cursor).toBe(0);
    expect(skills.state.offset).toBe(0);
    expect(servers.state.cursor).toBe(0);
    expect(services.state.cursor).toBe(0);
  });

  test('preserves modeIdx', () => {
    const { state, skills, servers, services } = setupActiveSync();
    state.modeIdx = 3;
    const next = resetAfterRun(state, { skills, servers, services });
    expect(next.modeIdx).toBe(3);
  });
});

// ── llmTools ────────────────────────────────────────────

describe('sync llmTools', () => {
  const findTool = (name: string) => syncPlugin.llmTools!.find(t => t.name === name)!;

  test('sync.getState returns widget selections + plugin mode', async () => {
    const { state, ctx, skills, servers, services } = setupActiveSync();
    skills.state.selected.add('skillA');
    servers.state.selected.add('srv1');
    services.state.selected.add('claude');
    state.modeIdx = 0;
    const result = await findTool('sync.getState').handler({}, ctx) as any;
    expect(result.active).toBe(true);
    expect(result.skills).toEqual(['skillA']);
    expect(result.servers).toEqual(['srv1']);
    expect(result.services).toEqual(['claude']);
    expect(result.mode).toBe('clean');
  });

  test('sync.listAvailable returns full items lists', async () => {
    const { ctx } = setupActiveSync();
    const result = await findTool('sync.listAvailable').handler({}, ctx) as any;
    expect(result.active).toBe(true);
    expect(result.skills).toEqual(['skillA', 'skillB', 'skillC']);
    expect(result.servers).toEqual(['srv1', 'srv2']);
    expect(result.services).toEqual(['claude', 'cursor']);
  });

  test('sync.getState reports inactive when widgets are missing', async () => {
    const state = syncPlugin.initialState();
    const host = makeFakeHost();
    const ctx = makeCtx(state, host);  // no widgets spawned
    const result = await findTool('sync.getState').handler({}, ctx) as any;
    expect(result.active).toBe(false);
  });
});

// ── Lifecycle ───────────────────────────────────────────

describe('sync plugin lifecycle', () => {
  test('onActivate / onDeactivate log through ctx', async () => {
    const logs: string[] = [];
    const host = makeFakeHost();
    const state = syncPlugin.initialState();
    const ctx = {
      ...makeCtx(state, host),
      log: (l: string) => logs.push(l),
    };
    await syncPlugin.onActivate?.(ctx);
    await syncPlugin.onDeactivate?.(ctx);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('sync');
    expect(logs[1]).toContain('sync');
  });
});

// ── renderSyncCell (legacy) ─────────────────────────────
// Kept as a smoke test in case something else starts consuming
// renderSyncCell as a standalone helper.

describe('renderSyncCell (legacy helper)', () => {
  test('selected items contain the filled-circle mark', () => {
    const out = renderSyncCell({
      pane: 1, row: 0, paneWidth: 20,
      list: ['server1'], cursor: 0, offset: 0,
      selected: new Set(['server1']), activePane: 1,
      allSkillCount: 0, allSelected: false,
    });
    expect(out).toContain('\u25CF');
  });
});
