import type { PanePlan, PanePlanUnknown } from './pane-plan';

export type PaneLayoutPosition = 'split' | 'tab';

export interface PaneLayoutSlot {
  terminalId: string;
  position: PaneLayoutPosition;
}

/** A render-independent, JSON-serializable set of terminal slots for one run. */
export interface PaneLayout {
  runId: string;
  slots: PaneLayoutSlot[];
}

/** A render-independent, JSON-serializable expansion of a pane plan. */
export interface PaneLayoutResult {
  layouts: PaneLayout[];
  unknown: PanePlanUnknown[];
}

/** Runtime measurements required to divide a terminal panel's vertical space. */
export interface PaneVerticalBudgetInput {
  availableHeight: number;
  fixedRowHeights: readonly number[];
  terminalMinHeight: number;
  dockMinHeight: number;
  dockPreferredHeight: number;
  dockMaxHeight: number;
}

export interface PaneVerticalBudgetAllocation {
  status: 'allocated';
  terminalHeight: number;
  dockHeight: number;
}

export interface PaneVerticalBudgetUnavailable {
  status: 'unknown' | 'insufficient-minimums';
  terminalHeight: null;
  dockHeight: null;
}

/** A renderer-independent vertical allocation, or an explicit absence of one. */
export type PaneVerticalBudget = PaneVerticalBudgetAllocation | PaneVerticalBudgetUnavailable;

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Divides measured panel height without reading the DOM or producing render instructions.
 * Terminal and dock minima must both fit; otherwise no invented allocation is returned.
 * When they do fit, the terminal minimum is reserved first and the dock shrinks from
 * its preferred height down to its minimum before additional height reaches the terminal.
 */
export function paneVerticalBudget(input: PaneVerticalBudgetInput): PaneVerticalBudget {
  const {
    availableHeight,
    fixedRowHeights,
    terminalMinHeight,
    dockMinHeight,
    dockPreferredHeight,
    dockMaxHeight,
  } = input;
  if (![availableHeight, terminalMinHeight, dockMinHeight, dockPreferredHeight, dockMaxHeight]
    .every(isNonNegativeFinite)
    || !Array.isArray(fixedRowHeights)
    || !fixedRowHeights.every(isNonNegativeFinite)
    || dockMinHeight > dockMaxHeight) {
    return { status: 'unknown', terminalHeight: null, dockHeight: null };
  }

  const fixedHeight = fixedRowHeights.reduce((total, height) => total + height, 0);
  const contentHeight = availableHeight - fixedHeight;
  const dockCap = Math.max(dockMinHeight, Math.min(dockPreferredHeight, dockMaxHeight));
  if (contentHeight < terminalMinHeight + dockMinHeight) {
    return { status: 'insufficient-minimums', terminalHeight: null, dockHeight: null };
  }

  const dockHeight = Math.min(dockCap, contentHeight - terminalMinHeight);
  return {
    status: 'allocated',
    terminalHeight: contentHeight - dockHeight,
    dockHeight,
  };
}

/**
 * Expands planned terminal placements into renderer-neutral per-run slots.
 * Unknown plan entries retain their original values outside layouts and receive no placement.
 */
export function paneLayout(plan: PanePlan): PaneLayoutResult {
  return {
    layouts: plan.layouts.map(({ runId, split, tabs }) => ({
      runId,
      slots: [
        { terminalId: split, position: 'split' },
        ...tabs.map((terminalId) => ({ terminalId, position: 'tab' as const })),
      ],
    })),
    unknown: plan.unknown.map((entry) => ({ ...entry })),
  };
}

/**
 * Narrows a full layout to the run that owns the selected terminal.
 *
 * ⛔⭐ 왜 필요한가 (대표 2026-08-17): *"아이디를 선택한 순간 터미널 화면도 바뀌어야 하고
 * 전체 select 가 바뀌어야 합니다"*.
 * 📏 그 전 실물 — TerminalPanel 은 `paneLayout` 에 항목이 «하나라도» 있으면 그 배치를 그리고,
 *    선택(`terminalId`)을 따르는 단일 뷰는 «배치가 빈 경우에만» 살아났다.
 *    그래서 칩을 눌러도 부제만 바뀌고 화면은 그대로였다.
 *
 * 선택이 이긴다. 다만 창분할(런 안의 split ⊕ tab)은 «그 런 안에서» 유지된다.
 * ⛔ 선택이 어느 런에도 없으면 «지어내지 않고» 빈 layouts 를 돌려준다 — 호출자가
 *   단일 뷰로 떨어지게 한다. (pane-plan 의 「관계를 모르면 배치를 지어내지 않는다」와 같은 태도)
 */
export function paneLayoutForSelection(
  layout: PaneLayoutResult,
  selectedTerminalId: string,
): PaneLayoutResult {
  const selected = selectedTerminalId.trim();
  if (!selected) return { layouts: [], unknown: layout.unknown.map((entry) => ({ ...entry })) };
  const owning = layout.layouts.filter(
    ({ slots }) => slots.some((slot) => slot.terminalId === selected),
  );
  return {
    layouts: owning.map((entry) => ({ runId: entry.runId, slots: entry.slots.map((slot) => ({ ...slot })) })),
    unknown: layout.unknown.map((entry) => ({ ...entry })),
  };
}
