import { describe, expect, test } from 'bun:test';

import { paneLayout, paneLayoutForSelection, paneVerticalBudget, type PaneLayout, type PaneLayoutResult } from './pane-layout';
import type { PanePlan } from './pane-plan';

const plan = (layouts: PanePlan['layouts'], unknown: PanePlan['unknown'] = []): PanePlan => ({
  layouts,
  unknown,
});

describe('paneLayout', () => {
  test('expands a split and two tabs into distinct relative slots', () => {
    const layout = paneLayout(plan([
      { runId: 'run-a', split: 'terminal-split', tabs: ['terminal-tab-a', 'terminal-tab-b'] },
    ]));

    expect(layout).toEqual({
      layouts: [
        {
          runId: 'run-a',
          slots: [
            { terminalId: 'terminal-split', position: 'split' },
            { terminalId: 'terminal-tab-a', position: 'tab' },
            { terminalId: 'terminal-tab-b', position: 'tab' },
          ],
        },
      ],
      unknown: [],
    });
    expect(layout.layouts[0]!.slots.filter(({ position }) => position === 'split')).toHaveLength(1);
    expect(layout.layouts[0]!.slots.filter(({ position }) => position === 'tab')).toHaveLength(2);
  });

  test('expands a tabless run to its split slot only', () => {
    expect(paneLayout(plan([
      { runId: 'run-a', split: 'terminal-split', tabs: [] },
    ]))).toEqual({
      layouts: [
        {
          runId: 'run-a',
          slots: [{ terminalId: 'terminal-split', position: 'split' }],
        },
      ],
      unknown: [],
    });
  });

  test('keeps separate runs in separate layout groups', () => {
    expect(paneLayout(plan([
      { runId: 'run-a', split: 'terminal-a', tabs: ['terminal-a-tab'] },
      { runId: 'run-b', split: 'terminal-b', tabs: [] },
    ]))).toEqual({
      layouts: [
        {
          runId: 'run-a',
          slots: [
            { terminalId: 'terminal-a', position: 'split' },
            { terminalId: 'terminal-a-tab', position: 'tab' },
          ],
        },
        {
          runId: 'run-b',
          slots: [{ terminalId: 'terminal-b', position: 'split' }],
        },
      ],
      unknown: [],
    });
  });

  test('does not turn unknown entries into slots', () => {
    const layout = paneLayout(plan(
      [{ runId: 'run-a', split: 'terminal-a', tabs: [] }],
      [{ id: 'unknown-terminal', reason: 'relationship-unavailable' }],
    ));

    expect(layout.layouts.flatMap(({ slots }) => slots.map(({ terminalId }) => terminalId))).not.toContain('unknown-terminal');
    expect(layout.unknown).toEqual([{ id: 'unknown-terminal', reason: 'relationship-unavailable' }]);
  });

  test('uses no render instructions and is deterministic across JSON round trips', () => {
    const input = plan(
      [{ runId: 'run-a', split: 'terminal-a', tabs: ['terminal-a-tab'] }],
      [
        { id: 'unknown-first', reason: 'relationship-unavailable' },
        { id: 'unknown-second', reason: 'relationship-unavailable' },
      ],
    );
    const once = paneLayout(input);
    const serialized = JSON.stringify(once);

    expect(paneLayout(input)).toEqual(once);
    expect(JSON.parse(serialized)).toEqual(once);
    expect(serialized).not.toMatch(/px|%|css/i);
  });
});

describe('paneVerticalBudget', () => {
  const measuredPanel = {
    availableHeight: 469,
    fixedRowHeights: [18, 15],
    terminalMinHeight: 160,
    dockMinHeight: 200,
    dockPreferredHeight: 360,
    dockMaxHeight: 360,
  };

  test('reserves a positive terminal allocation in the measured short window', () => {
    expect(paneVerticalBudget(measuredPanel)).toEqual({
      status: 'allocated',
      terminalHeight: 160,
      dockHeight: 276,
    });
  });

  test('caps a roomy dock at its existing maximum and gives remaining height to terminal', () => {
    expect(paneVerticalBudget({ ...measuredPanel, availableHeight: 800 })).toEqual({
      status: 'allocated',
      terminalHeight: 407,
      dockHeight: 360,
    });
  });

  test('shrinks the dock before allowing the terminal below its minimum', () => {
    expect(paneVerticalBudget({ ...measuredPanel, availableHeight: 400 })).toEqual({
      status: 'allocated',
      terminalHeight: 160,
      dockHeight: 207,
    });
  });

  test('allocates exactly the terminal and dock minimums without collapsing terminal height', () => {
    expect(paneVerticalBudget({ ...measuredPanel, availableHeight: 393 })).toEqual({
      status: 'allocated',
      terminalHeight: 160,
      dockHeight: 200,
    });
  });

  test('reports insufficient minimums instead of inventing a zero terminal allocation', () => {
    expect(paneVerticalBudget({ ...measuredPanel, availableHeight: 392 })).toEqual({
      status: 'insufficient-minimums',
      terminalHeight: null,
      dockHeight: null,
    });
  });

  test('reports unknown for invalid row measurements, contradictory dock bounds, and remains JSON serializable', () => {
    const invalidMeasurement = paneVerticalBudget({
      ...measuredPanel,
      fixedRowHeights: [18, Number.NaN],
    });
    const contradictoryDockBounds = paneVerticalBudget({
      ...measuredPanel,
      dockMinHeight: 361,
      dockMaxHeight: 360,
    });

    expect(invalidMeasurement).toEqual({ status: 'unknown', terminalHeight: null, dockHeight: null });
    expect(contradictoryDockBounds).toEqual({ status: 'unknown', terminalHeight: null, dockHeight: null });
    expect(JSON.parse(JSON.stringify(contradictoryDockBounds))).toEqual(contradictoryDockBounds);
    expect(JSON.stringify(contradictoryDockBounds)).not.toMatch(/px|%|css/i);
  });
});

// 대표 2026-08-17 — "아이디를 선택한 순간 터미널 화면도 바뀌어야 하고 전체 select 가 바뀌어야 합니다".
describe('paneLayoutForSelection — 선택이 화면을 정한다', () => {
  const layout: PaneLayoutResult = {
    layouts: [
      { runId: 'run-A', slots: [
        { terminalId: 'self_a1', position: 'split' },
        { terminalId: 'self_a2', position: 'tab' },
      ] },
      { runId: 'run-B', slots: [{ terminalId: 'self_b1', position: 'split' }] },
    ],
    unknown: [{ id: 'preview-1', reason: 'relationship-unavailable' }],
  };

  test('선택된 터미널이 속한 런«만» 남는다 — 그 런의 창분할은 유지된다', () => {
    const got = paneLayoutForSelection(layout, 'self_a2');
    expect(got.layouts).toHaveLength(1);
    expect(got.layouts[0].runId).toBe('run-A');
    expect(got.layouts[0].slots.map((s) => s.terminalId)).toEqual(['self_a1', 'self_a2']);
  });

  test('다른 런을 선택하면 화면이 «그 런»으로 바뀐다', () => {
    expect(paneLayoutForSelection(layout, 'self_b1').layouts[0].runId).toBe('run-B');
  });

  test('어느 런에도 없는 선택은 배치를 «지어내지 않는다» — 호출자가 단일 뷰로 떨어진다', () => {
    const got = paneLayoutForSelection(layout, 'preview-1');
    expect(got.layouts).toHaveLength(0);
    expect(got.unknown).toEqual([{ id: 'preview-1', reason: 'relationship-unavailable' }]);
  });

  test('빈 선택도 배치를 지어내지 않는다', () => {
    expect(paneLayoutForSelection(layout, '   ').layouts).toHaveLength(0);
  });

  test('원본을 «안 건드린다» — 슬롯을 복사해 돌려준다', () => {
    const got = paneLayoutForSelection(layout, 'self_a1');
    got.layouts[0].slots[0].terminalId = 'mutated';
    expect(layout.layouts[0].slots[0].terminalId).toBe('self_a1');
  });
});
