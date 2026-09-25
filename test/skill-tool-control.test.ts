import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildControlTools,
  dispatchControlWindowResize,
  dispatchControlPaneResize,
  dispatchControlPaneLayout,
  dispatchControlToolToggle,
  dispatchControlPromptAppend,
  setControlRuntimeDeps,
} from '../src/skills/tools/control.js';
import {
  drainPromptHintsForTurn,
  _resetPromptHintsForTesting,
} from '../src/prompt/hint-store.js';
import { nativeToolCatalog } from '../src/native-tool-catalog.js';

// Minimal WindowRegistry-like stub — only the shape our dispatchers need.
function mkStubRegistry() {
  const windows = new Map<number, {
    id: number;
    title: string;
    bounds: { row: number; col: number; width: number; height: number };
    panes: Array<{ id: string; content: { kind: string; title?: string } }>;
    focused: string;
    resizeCalls: Array<{ paneId: string; axis: 'h' | 'v'; delta: number }>;
    splitCalls: Array<{ axis: 'h' | 'v' }>;
    getBounds(): any;
    setBounds(b: any): void;
    listPanes(): any;
    resizePaneAt(paneId: string, axis: 'h' | 'v', delta: number): boolean;
    splitFocused(axis: 'h' | 'v', content: any): string;
  }>();

  const reg = {
    list: () => [...windows.values()],
    current: () => [...windows.values()][0] ?? null,
    _spawn(id: number, title: string, paneId: string) {
      const w = {
        id, title,
        bounds: { row: 1, col: 1, width: 80, height: 24 },
        panes: [{ id: paneId, content: { kind: 'terminal', title: 'shell' } }],
        focused: paneId,
        resizeCalls: [] as Array<{ paneId: string; axis: 'h' | 'v'; delta: number }>,
        splitCalls: [] as Array<{ axis: 'h' | 'v' }>,
        getBounds() { return { ...this.bounds }; },
        setBounds(b: any) { this.bounds = { ...b }; },
        listPanes() { return [...this.panes]; },
        resizePaneAt(paneId: string, axis: 'h' | 'v', delta: number) {
          this.resizeCalls.push({ paneId, axis, delta });
          return this.panes.some(p => p.id === paneId);
        },
        splitFocused(axis: 'h' | 'v', content: any) {
          this.splitCalls.push({ axis });
          this.panes.push({ id: `p${this.panes.length}`, content });
          return `p${this.panes.length - 1}`;
        },
      };
      windows.set(id, w as any);
      return w;
    },
  };
  return reg;
}

describe('skill-tool-control / specs', () => {
  test('builds 6 specs with unique names', () => {
    const tools = buildControlTools();
    expect(tools).toHaveLength(6);
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(6);
    expect(names).toEqual([
      'ControlWindowResize',
      'ControlPaneResize',
      'ControlPaneLayout',
      'ControlToolToggle',
      'ControlPromptAppend',
      'ControlPromptClear',
    ]);
  });
});

describe('skill-tool-control / window + pane resize', () => {
  let reg: any;

  beforeEach(() => {
    reg = mkStubRegistry();
    reg._spawn(3, 'main', 'aa');
    setControlRuntimeDeps({ getWindowRegistry: () => reg });
  });

  test('window resize updates bounds', async () => {
    const r = await dispatchControlWindowResize({ addr: 'win:3', width: 120, height: 40 });
    expect(r.ok).toBe(true);
    expect((r.bounds as any).width).toBe(120);
    expect(reg.list()[0].bounds).toMatchObject({ width: 120, height: 40 });
  });

  test('window resize rejects below minimum', async () => {
    const r = await dispatchControlWindowResize({ addr: 'win:3', width: 5, height: 2 });
    expect(r.ok).toBe(false);
  });

  test('window resize on unknown window', async () => {
    const r = await dispatchControlWindowResize({ addr: 'win:9', width: 80 });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('unknown');
  });

  test('pane resize routes to the owning window', async () => {
    const r = await dispatchControlPaneResize({ addr: 'pane:aa', axis: 'h', delta: 5 });
    expect(r.ok).toBe(true);
    expect(reg.list()[0].resizeCalls).toEqual([{ paneId: 'aa', axis: 'h', delta: 5 }]);
  });

  test('pane resize rejects zero delta', async () => {
    const r = await dispatchControlPaneResize({ addr: 'pane:aa', axis: 'v', delta: 0 });
    expect(r.ok).toBe(false);
  });

  test('pane resize on unknown pane', async () => {
    const r = await dispatchControlPaneResize({ addr: 'pane:zz', axis: 'h', delta: 5 });
    expect(r.ok).toBe(false);
  });
});

describe('skill-tool-control / pane layout', () => {
  beforeEach(() => _resetPromptHintsForTesting());

  test('2x2 layout splits 3 times', async () => {
    const reg = mkStubRegistry();
    const w = reg._spawn(1, 'a', 'root');
    setControlRuntimeDeps({
      getWindowRegistry: () => reg,
      defaultPaneSpec: () => ({ kind: 'terminal' } as any),
    });
    const r = await dispatchControlPaneLayout({ windowAddr: 'win:1', layout: '2x2' });
    expect(r.ok).toBe(true);
    expect(w.splitCalls).toHaveLength(3);
    // 2x2 plan: h, v, v
    expect(w.splitCalls.map(s => s.axis)).toEqual(['h', 'v', 'v']);
  });

  test('invalid layout rejected', async () => {
    const reg = mkStubRegistry();
    reg._spawn(1, 'a', 'root');
    setControlRuntimeDeps({ getWindowRegistry: () => reg });
    const r = await dispatchControlPaneLayout({ windowAddr: 'win:1', layout: '7x7' });
    expect(r.ok).toBe(false);
  });
});

describe('skill-tool-control / tool toggle', () => {
  test('flips defaultEnabled on a catalog entry', async () => {
    const before = nativeToolCatalog.find(t => t.id === 'bash')!;
    const prior = before.defaultEnabled;
    const r1 = await dispatchControlToolToggle({ toolId: 'bash', enabled: !prior });
    expect(r1.ok).toBe(true);
    expect(before.defaultEnabled).toBe(!prior);
    // Restore to avoid leaking into other tests
    await dispatchControlToolToggle({ toolId: 'bash', enabled: prior });
  });

  test('unknown tool rejected', async () => {
    const r = await dispatchControlToolToggle({ toolId: 'nope', enabled: true });
    expect(r.ok).toBe(false);
  });
});

describe('skill-tool-control / prompt append', () => {
  beforeEach(() => _resetPromptHintsForTesting());

  test('stores turn-scoped hint and drains on turn', async () => {
    const r = await dispatchControlPromptAppend({ text: 'JSON only', scope: 'turn' });
    expect(r.ok).toBe(true);
    expect(drainPromptHintsForTurn()).toBe('JSON only');
    // Drained: next call returns empty.
    expect(drainPromptHintsForTurn()).toBe('');
  });

  test('session-scoped hint persists across turn drains', async () => {
    await dispatchControlPromptAppend({ text: 'Use bun not npm', scope: 'session' });
    expect(drainPromptHintsForTurn()).toBe('Use bun not npm');
    expect(drainPromptHintsForTurn()).toBe('Use bun not npm');
  });

  test('empty text rejected', async () => {
    const r = await dispatchControlPromptAppend({ text: '   ' });
    expect(r.ok).toBe(false);
  });
});
