import { describe, expect, test } from 'bun:test';

import {
  planTabletCompanionSlot,
  resolveTabletConversationLayoutMode,
  resolveTabletWorkspacePolicy,
  resolveTabletWorkspaceViewport,
} from '../src/window/tablet-workspace-policy.js';

describe('tablet-workspace-policy', () => {
  test('tablet viewport with blocking foreground keeps one companion visible and parks the rest', () => {
    const policy = resolveTabletWorkspacePolicy({
      termCols: 96,
      termRows: 28,
      hasBlockingForeground: true,
      companionCount: 3,
    });
    expect(policy.viewport).toBe('tablet');
    expect(policy.workspaceLayoutMode).toBe('stack');
    expect(policy.visibleCompanionLimit).toBe(1);

    const first = planTabletCompanionSlot({
      termCols: 96,
      termRows: 28,
      slotIndex: 0,
      totalCount: 3,
      hasBlockingForeground: true,
    });
    const second = planTabletCompanionSlot({
      termCols: 96,
      termRows: 28,
      slotIndex: 1,
      totalCount: 3,
      hasBlockingForeground: true,
    });

    expect(first.visible).toBe(true);
    expect(first.placement).toBe('bottom-drawer');
    expect(first.bounds?.row).toBeGreaterThanOrEqual(17);
    expect(second.parked).toBe(true);
    expect(second.bounds).toBeNull();
  });

  test('compact viewport without blocking foreground shows two stacked companions', () => {
    const first = planTabletCompanionSlot({
      termCols: 128,
      termRows: 32,
      slotIndex: 0,
      totalCount: 2,
      hasBlockingForeground: false,
    });
    const second = planTabletCompanionSlot({
      termCols: 128,
      termRows: 32,
      slotIndex: 1,
      totalCount: 2,
      hasBlockingForeground: false,
    });

    expect(resolveTabletWorkspaceViewport(128)).toBe('compact');
    expect(first.placement).toBe('right-stack');
    expect(second.visible).toBe(true);
    expect(second.bounds!.row).toBeGreaterThan(first.bounds!.row);
    expect(second.bounds!.col).toBe(first.bounds!.col);
  });

  test('wide viewport preserves cascade companions and requested conversation layout', () => {
    const plan = planTabletCompanionSlot({
      termCols: 180,
      termRows: 44,
      slotIndex: 2,
      totalCount: 3,
      hasBlockingForeground: false,
    });
    expect(plan.placement).toBe('right-cascade');
    expect(resolveTabletConversationLayoutMode('cascade', 180, 44, 3)).toBe('cascade');
  });

  test('conversation popup layout downgrades on tablet and compact widths', () => {
    expect(resolveTabletConversationLayoutMode('cascade', 96, 28, 2)).toBe('stack');
    expect(resolveTabletConversationLayoutMode('tile', 96, 28, 1)).toBe('stack');
    expect(resolveTabletConversationLayoutMode('cascade', 128, 32, 2)).toBe('stack');
    expect(resolveTabletConversationLayoutMode('cascade', 128, 32, 3)).toBe('tile');
  });
});
