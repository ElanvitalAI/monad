// ── Layout tools tests ──
// Exercise the LLM-callable layout mutation tools against a live
// layout + widget host pair.

import { describe, test, expect, beforeEach } from 'bun:test';
import { WidgetHost } from '../src/widgets/host.js';
import { createLayoutTools, type LayoutToolDeps } from '../src/layout/tools.js';
import { createLayout } from '../src/layout/host.js';
import type { Layout } from '../src/layout/types.js';
import type { WidgetDef } from '../src/widgets/types.js';

function makeEnv(): LayoutToolDeps & { layoutRef: { v: Layout }; notices: string[]; widgetHost: WidgetHost } {
  const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
  const fake: WidgetDef = { type: 'fake', description: '',
    initialState: () => ({}), render: () => [] };
  widgetHost.register(fake);
  const layoutRef = {
    v: createLayout([
      { height: 1, cells: [{ widgetInstanceId: null, width: 'flex' }] },
      { height: 'flex', cells: [{ widgetInstanceId: null, width: 'flex' }] },
    ]),
  };
  const notices: string[] = [];
  return {
    widgetHost,
    layoutRef,
    notices,
    getCurrentLayout: () => layoutRef.v,
    setCurrentLayout: (next) => { layoutRef.v = next; },
    notify: (m) => notices.push(m),
  };
}

const ctx = () => ({
  pluginName: '',
  state: {},
  setState: () => {},
  log: () => {}, hudSet: () => {}, requestRender: () => {},
  focusPane: () => {}, getWidget: () => null,
});

const fire = async (tool: any, args: any) => tool.handler(args, ctx());

describe('layout-tools', () => {
  let env: ReturnType<typeof makeEnv>;
  let tools: ReturnType<typeof createLayoutTools>;
  const byName = (name: string) => tools.find(t => t.name === name)!;

  beforeEach(() => {
    env = makeEnv();
    tools = createLayoutTools(env);
  });

  test('layout_getState reports rows + widgets + available types', async () => {
    const r = await fire(byName('layout_getState'), {}) as any;
    expect(r.rows).toHaveLength(2);
    expect(r.availableWidgetTypes.map((w: any) => w.type)).toContain('fake');
  });

  test('layout_addWidget spawns and places into an empty cell', async () => {
    const r = await fire(byName('layout_addWidget'), {
      type: 'fake', row: 0, col: 0, character: 'Tile',
    }) as any;
    expect(r.id).toBeTruthy();
    expect(env.layoutRef.v.rows[0]!.cells[0]!.widgetInstanceId).toBe(r.id);
    expect(env.widgetHost.get(r.id)).not.toBeNull();
  });

  test('layout_addWidget rejects unknown widget type', async () => {
    await expect(fire(byName('layout_addWidget'), {
      type: 'ghost', row: 0, col: 0,
    })).rejects.toThrow(/unknown widget type/);
  });

  test('layout_removeWidget clears cell and disposes instance', async () => {
    const add = await fire(byName('layout_addWidget'), { type: 'fake', row: 1, col: 0 }) as any;
    const r = await fire(byName('layout_removeWidget'), { id: add.id }) as any;
    expect(r.removed).toBe(true);
    expect(env.layoutRef.v.rows[1]!.cells[0]!.widgetInstanceId).toBeNull();
    expect(env.widgetHost.get(add.id)).toBeNull();
  });

  test('layout_removeWidget returns removed:false on unknown id', async () => {
    const r = await fire(byName('layout_removeWidget'), { id: 'ghost' }) as any;
    expect(r.removed).toBe(false);
  });

  test('layout_resizeCell updates width', async () => {
    await fire(byName('layout_resizeCell'), { row: 0, col: 0, width: 0.25 });
    expect(env.layoutRef.v.rows[0]!.cells[0]!.width).toBe(0.25);
  });

  test('layout_resizeCell accepts "flex"', async () => {
    await fire(byName('layout_resizeCell'), { row: 0, col: 0, width: 'flex' });
    expect(env.layoutRef.v.rows[0]!.cells[0]!.width).toBe('flex');
  });

  test('layout_addRow appends at end by default', async () => {
    const before = env.layoutRef.v.rows.length;
    await fire(byName('layout_addRow'), {});
    expect(env.layoutRef.v.rows.length).toBe(before + 1);
  });

  test('layout_removeRow removes the target row', async () => {
    await fire(byName('layout_removeRow'), { row: 1 });
    expect(env.layoutRef.v.rows).toHaveLength(1);
  });

  test('layout_openModal + closeModal lifecycle', async () => {
    const opened = await fire(byName('layout_openModal'), {
      id: 'm1', widgetType: 'fake', character: 'Hello',
    }) as any;
    expect(env.layoutRef.v.modals).toHaveLength(1);
    expect(env.widgetHost.get(opened.widgetId)).not.toBeNull();
    const closed = await fire(byName('layout_closeModal'), { id: 'm1' }) as any;
    expect(closed.closed).toBe(true);
    expect(env.layoutRef.v.modals).toHaveLength(0);
    expect(env.widgetHost.get(opened.widgetId)).toBeNull();
  });

  test('layout_openModal rejects duplicate modal id', async () => {
    await fire(byName('layout_openModal'), { id: 'dup', widgetType: 'fake' });
    await expect(fire(byName('layout_openModal'), { id: 'dup', widgetType: 'fake' })).rejects.toThrow(/already open/);
  });

  test('layout_setWidgetState merges a patch into widget state', async () => {
    // Register markdown type first
    env.widgetHost.register({
      type: 'markdown-fake',
      description: '',
      initialState: () => ({ text: '', scroll: 0 }),
      render: () => [],
    });
    const add = await fire(byName('layout_addWidget'), {
      type: 'markdown-fake', row: 0, col: 0,
    }) as any;
    await fire(byName('layout_setWidgetState'), {
      id: add.id, patch: { text: 'hello world' },
    });
    const inst = env.widgetHost.get(add.id);
    expect((inst!.state as any).text).toBe('hello world');
  });

  test('layout_setWidgetState on unknown id throws', async () => {
    await expect(fire(byName('layout_setWidgetState'), {
      id: 'ghost', patch: { x: 1 },
    })).rejects.toThrow(/not found/);
  });

  test('notify is called on successful mutations', async () => {
    await fire(byName('layout_addRow'), {});
    expect(env.notices.length).toBeGreaterThan(0);
    expect(env.notices[env.notices.length - 1]).toContain('added row');
  });

  test('onWidgetStatePatched hook fires with id + patch after successful patch', async () => {
    // Regression: grok-4.20 wrote 조선 왕 list to wd-scratch via
    // layout_setWidgetState — the call returned success but the
    // dashboard's next draw() overwrote state.text from its own
    // scratchLines buffer, and the LLM's write disappeared. The
    // hook lets dashboards mirror the patch into whatever internal
    // buffer they use as source-of-truth for that widget.
    const hits: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const env2 = makeEnv();
    env2.widgetHost.register({
      type: 'markdown-hook',
      description: '',
      initialState: () => ({ text: '', scroll: 0 }),
      render: () => [],
    });
    const tools2 = createLayoutTools({
      ...env2,
      onWidgetStatePatched: (id, patch) => hits.push({ id, patch }),
    });
    const addTool = tools2.find(t => t.name === 'layout_addWidget')!;
    const setTool = tools2.find(t => t.name === 'layout_setWidgetState')!;
    const add = await addTool.handler({ type: 'markdown-hook', row: 0, col: 0 }, ctx()) as any;
    await setTool.handler({ id: add.id, patch: { text: 'mirrored' } }, ctx());
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe(add.id);
    expect(hits[0]!.patch).toEqual({ text: 'mirrored' });
  });

  test('onWidgetStatePatched exceptions are swallowed — patch still succeeds', async () => {
    const env2 = makeEnv();
    env2.widgetHost.register({
      type: 'markdown-hook',
      description: '',
      initialState: () => ({ text: '', scroll: 0 }),
      render: () => [],
    });
    const tools2 = createLayoutTools({
      ...env2,
      onWidgetStatePatched: () => { throw new Error('mirror broken'); },
    });
    const addTool = tools2.find(t => t.name === 'layout_addWidget')!;
    const setTool = tools2.find(t => t.name === 'layout_setWidgetState')!;
    const add = await addTool.handler({ type: 'markdown-hook', row: 0, col: 0 }, ctx()) as any;
    const result = await setTool.handler({ id: add.id, patch: { text: 'k' } }, ctx()) as any;
    expect(result.patched).toEqual(['text']);
    const inst = env2.widgetHost.get(add.id);
    expect((inst!.state as any).text).toBe('k');
  });

  test('absent onWidgetStatePatched hook — patch works unchanged', async () => {
    // Default createLayoutTools (no hook) continues to behave as before.
    env.widgetHost.register({
      type: 'markdown-nohook',
      description: '',
      initialState: () => ({ text: '', scroll: 0 }),
      render: () => [],
    });
    const add = await fire(byName('layout_addWidget'), {
      type: 'markdown-nohook', row: 0, col: 0,
    }) as any;
    const result = await fire(byName('layout_setWidgetState'), {
      id: add.id, patch: { text: 'ok' },
    }) as any;
    expect(result.patched).toEqual(['text']);
  });
});
