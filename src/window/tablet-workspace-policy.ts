import type { ModalBounds } from '../display/modal-stack.js';

export type TabletWorkspaceViewport = 'tablet' | 'compact' | 'wide';
export type TabletWorkspaceLayoutMode = 'stack' | 'desktop';
export type TabletCompanionPlacement = 'bottom-drawer' | 'right-stack' | 'right-cascade' | 'parked';
export type TabletConversationLayoutMode = 'cascade' | 'tile' | 'stack';

export interface TabletWorkspacePolicyInput {
  termCols: number;
  termRows: number;
  hasBlockingForeground: boolean;
  companionCount: number;
}

export interface TabletWorkspacePolicy {
  readonly viewport: TabletWorkspaceViewport;
  readonly workspaceLayoutMode: TabletWorkspaceLayoutMode;
  readonly visibleCompanionLimit: number;
  readonly companionPlacement: Exclude<TabletCompanionPlacement, 'parked'>;
}

export interface TabletCompanionSlotInput {
  termCols: number;
  termRows: number;
  slotIndex: number;
  totalCount: number;
  hasBlockingForeground: boolean;
}

export interface TabletCompanionSlotPlan {
  readonly viewport: TabletWorkspaceViewport;
  readonly visible: boolean;
  readonly parked: boolean;
  readonly placement: TabletCompanionPlacement;
  readonly bounds: ModalBounds | null;
  readonly maxVisible: number;
}

export function resolveTabletWorkspaceViewport(termCols: number): TabletWorkspaceViewport {
  if (termCols < 110) return 'tablet';
  if (termCols < 150) return 'compact';
  return 'wide';
}

export function resolveTabletWorkspacePolicy(
  input: TabletWorkspacePolicyInput,
): TabletWorkspacePolicy {
  const viewport = resolveTabletWorkspaceViewport(input.termCols);
  switch (viewport) {
    case 'tablet':
      return {
        viewport,
        workspaceLayoutMode: 'stack',
        visibleCompanionLimit: input.hasBlockingForeground ? 1 : Math.min(2, Math.max(1, input.companionCount)),
        companionPlacement: input.hasBlockingForeground ? 'bottom-drawer' : 'right-stack',
      };
    case 'compact':
      return {
        viewport,
        workspaceLayoutMode: 'desktop',
        visibleCompanionLimit: input.hasBlockingForeground ? 1 : Math.min(2, Math.max(1, input.companionCount)),
        companionPlacement: 'right-stack',
      };
    case 'wide':
    default:
      return {
        viewport: 'wide',
        workspaceLayoutMode: 'desktop',
        visibleCompanionLimit: Math.max(1, input.companionCount),
        companionPlacement: 'right-cascade',
      };
  }
}

export function planTabletCompanionSlot(
  input: TabletCompanionSlotInput,
): TabletCompanionSlotPlan {
  const policy = resolveTabletWorkspacePolicy({
    termCols: input.termCols,
    termRows: input.termRows,
    hasBlockingForeground: input.hasBlockingForeground,
    companionCount: input.totalCount,
  });
  if (input.slotIndex >= policy.visibleCompanionLimit) {
    return {
      viewport: policy.viewport,
      visible: false,
      parked: true,
      placement: 'parked',
      bounds: null,
      maxVisible: policy.visibleCompanionLimit,
    };
  }
  const bounds = computeVisibleCompanionBounds(policy, input.termCols, input.termRows, input.slotIndex);
  return {
    viewport: policy.viewport,
    visible: true,
    parked: false,
    placement: policy.companionPlacement,
    bounds,
    maxVisible: policy.visibleCompanionLimit,
  };
}

export function resolveTabletConversationLayoutMode(
  requested: TabletConversationLayoutMode,
  termCols: number,
  termRows: number,
  liveCount: number,
): TabletConversationLayoutMode {
  const viewport = resolveTabletWorkspaceViewport(termCols);
  if (viewport === 'tablet') return 'stack';
  if (liveCount <= 1) return requested;
  if (viewport === 'compact' && liveCount >= 2) {
    return liveCount >= 3 ? 'tile' : 'stack';
  }
  return requested;
}

function computeVisibleCompanionBounds(
  policy: TabletWorkspacePolicy,
  termCols: number,
  termRows: number,
  slotIndex: number,
): ModalBounds {
  const cols = Math.max(40, termCols);
  const rows = Math.max(12, termRows);
  switch (policy.companionPlacement) {
    case 'bottom-drawer': {
      const width = Math.max(34, cols - 2);
      const height = clamp(Math.floor(rows * 0.26), 8, 11);
      return {
        row: Math.max(2, rows - height),
        col: 1,
        width,
        height,
      };
    }
    case 'right-stack': {
      const width = clamp(Math.floor(cols * 0.52), 34, Math.max(34, cols - 6));
      const height = clamp(Math.floor(rows * 0.30), 10, 14);
      return {
        row: clamp(2 + slotIndex * (height + 1), 2, Math.max(2, rows - height - 1)),
        col: Math.max(2, cols - width - 1),
        width,
        height,
      };
    }
    case 'right-cascade':
    default: {
      const width = clamp(Math.floor(cols * 0.38), 36, 72);
      const height = clamp(Math.floor(rows * 0.34), 10, 18);
      return {
        row: clamp(2 + slotIndex * 2, 2, Math.max(2, rows - height - 1)),
        col: clamp(cols - width - 2 - slotIndex * 2, 2, Math.max(2, cols - width - 1)),
        width,
        height,
      };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
