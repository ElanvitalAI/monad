import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildDashboardWidgetListTool,
  buildDashboardWidgetToggleTool,
  buildDashboardPaneFocusTool,
  dispatchDashboardWidgetList,
  dispatchDashboardWidgetToggle,
  dispatchDashboardPaneFocus,
  initDashboardWidgetTools,
  _resetDashboardWidgetToolsForTesting,
  type DashboardWidgetHostOps,
} from '../src/skills/tools/dashboard-widget.js';

afterEach(() => {
  _resetDashboardWidgetToolsForTesting();
});

function mkOps(overrides: Partial<DashboardWidgetHostOps> = {}): DashboardWidgetHostOps {
  return {
    list: () => [],
    toggleFocus: () => null,
    focusPane: () => false,
    listPanes: () => ['browser', 'preview', 'log', 'input'],
    ...overrides,
  };
}

describe('schemas', () => {
  test('list + toggle + focus tools have expected names', () => {
    expect(buildDashboardWidgetListTool().name).toBe('DashboardWidgetList');
    expect(buildDashboardWidgetToggleTool().name).toBe('DashboardWidgetToggle');
    expect(buildDashboardPaneFocusTool().name).toBe('DashboardPaneFocus');
  });
});

describe('dispatchDashboardWidgetList', () => {
  test('empty list', async () => {
    const r = await dispatchDashboardWidgetList({}, {
      ops: mkOps({ list: () => [] }),
    });
    expect(r.output).toContain('no widgets');
  });

  test('renders widgets with focus markers', async () => {
    const r = await dispatchDashboardWidgetList({}, {
      ops: mkOps({ list: () => [
        { id: 'wd-log', type: 'log', focused: false },
        { id: 'wd-preview', type: 'markdown', focused: true },
      ] }),
    });
    expect(r.output).toContain('wd-log');
    expect(r.output).toContain('wd-preview');
    expect(r.output).toContain('●');
    expect(r.output).toContain('○');
    expect(r.output).toContain('(2)');
  });

  test('throws when not wired', async () => {
    await expect(dispatchDashboardWidgetList({})).rejects.toThrow(/not wired/);
  });
});

describe('dispatchDashboardWidgetToggle', () => {
  test('unknown id → error', async () => {
    await expect(dispatchDashboardWidgetToggle(
      { id: 'ghost' },
      { ops: mkOps({ toggleFocus: () => null }) },
    )).rejects.toThrow(/unknown widget id/);
  });

  test('empty id rejected', async () => {
    await expect(dispatchDashboardWidgetToggle(
      { id: '' },
      { ops: mkOps() },
    )).rejects.toThrow(/required/);
  });

  test('reports the new focus state', async () => {
    const r = await dispatchDashboardWidgetToggle(
      { id: 'wd-log' },
      { ops: mkOps({ toggleFocus: () => true }) },
    );
    expect(r.output).toContain('focused=true');
  });

  test('initDashboardWidgetTools wires default ops', async () => {
    let toggled = '';
    initDashboardWidgetTools(mkOps({
      toggleFocus: (id) => { toggled = id; return false; },
    }));
    const r = await dispatchDashboardWidgetToggle({ id: 'wd-log' });
    expect(toggled).toBe('wd-log');
    expect(r.output).toContain('focused=false');
  });
});

describe('dispatchDashboardPaneFocus', () => {
  test('invalid pane name surfaces valid list', async () => {
    const r = await dispatchDashboardPaneFocus(
      { name: 'nowhere' },
      { ops: mkOps() },
    );
    expect(r.output).toContain('not a known pane');
    expect(r.output).toContain('browser');
  });

  test('valid pane name → focuses', async () => {
    let focused = '';
    const r = await dispatchDashboardPaneFocus(
      { name: 'log' },
      { ops: mkOps({
        focusPane: (n) => { focused = n; return true; },
      }) },
    );
    expect(focused).toBe('log');
    expect(r.output).toContain('ok=true');
  });

  test('case-insensitive name match', async () => {
    const r = await dispatchDashboardPaneFocus(
      { name: 'PREVIEW' },
      { ops: mkOps({ focusPane: () => true }) },
    );
    expect(r.output).toContain('preview');
  });

  test('empty name rejected', async () => {
    await expect(dispatchDashboardPaneFocus(
      { name: '' },
      { ops: mkOps() },
    )).rejects.toThrow(/required/);
  });
});
