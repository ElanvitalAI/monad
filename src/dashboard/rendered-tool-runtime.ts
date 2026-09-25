import { FoldStack } from '../fold-stack.js';
import { truncateMiddle } from '../display/truncate.js';
import { debug } from '../debug/log.js';
import { foldKindHint } from '../log-entry.js';

export interface DashboardRenderedToolRuntimeDeps {
  chatLines: string[];
  foldStack: FoldStack;
  pinChatTail: () => void;
  draw: () => void;
  /** Wave P1 (A2-1) — line-budget viewport-aware truncate of the
   *  expanded fold variant. When set and the expanded form would
   *  occupy more rows than this budget after wrap, registerFold
   *  substitutes a head + ellipsis + tail trim so a 1MB Read or a
   *  1000-line Bash output cannot blow up chat on expand.
   *  Omit (or 0) to disable. */
  maxExpandedRows?: number;
  /** Terminal column width supplier for wrap accounting. Required
   *  when `maxExpandedRows` is set; ignored otherwise. */
  termCols?: () => number;
}

export interface DashboardRenderedToolRuntime {
  setArgs: (callId: string, args: Record<string, unknown>) => void;
  getArgs: (callId: string) => Record<string, unknown> | undefined;
  deleteArgs: (callId: string) => void;
  replaceBlock: (callId: string, nextLines: string[], assistantStart: number) => number;
  clearFold: (callId: string) => void;
  registerFold: (
    callId: string,
    collapsed: string[],
    expanded: string[] | null,
    grouping?: { operationKind?: string },
  ) => void;
}

export function createDashboardRenderedToolRuntime(
  deps: DashboardRenderedToolRuntimeDeps,
): DashboardRenderedToolRuntime {
  const renderedToolBlocks = new Map<string, { start: number; length: number }>();
  const renderedToolFoldIds = new Map<string, string>();
  const renderedToolArgs = new Map<string, Record<string, unknown>>();
  const kindUnitGroups = new Map<string, {
    operationKind: string;
    callIds: string[];
    foldId: string;
    start: number;
    collapsed: string[];
    expanded: string[];
  }>();
  const callKindGroup = new Map<string, string>();
  let lastKindGroupId: string | null = null;
  let kindGroupSeq = 0;

  const shiftBlocksAfter = (fromStart: number, delta: number, skipCallId?: string): void => {
    if (delta === 0) return;
    for (const [id, block] of renderedToolBlocks.entries()) {
      if (id === skipCallId || block.start <= fromStart) continue;
      renderedToolBlocks.set(id, { start: block.start + delta, length: block.length });
      const foldId = renderedToolFoldIds.get(id);
      if (foldId) deps.foldStack.shiftStatic(foldId, delta);
    }
    for (const group of kindUnitGroups.values()) {
      if (group.start > fromStart) group.start += delta;
    }
  };

  const clearFold = (callId: string): void => {
    const foldId = renderedToolFoldIds.get(callId);
    if (!foldId) return;
    const groupId = callKindGroup.get(callId);
    const group = groupId ? kindUnitGroups.get(groupId) : undefined;
    if (group && group.callIds.length > 1) {
      renderedToolFoldIds.delete(callId);
      return;
    }
    deps.foldStack.remove(foldId);
    renderedToolFoldIds.delete(callId);
    if (groupId) {
      kindUnitGroups.delete(groupId);
      callKindGroup.delete(callId);
      if (lastKindGroupId === groupId) lastKindGroupId = null;
    }
  };

  const replaceBlock = (callId: string, nextLines: string[], assistantStart: number): number => {
    const prior = renderedToolBlocks.get(callId);
    if (!prior) {
      const start = deps.chatLines.length;
      deps.chatLines.push(...nextLines);
      renderedToolBlocks.set(callId, { start, length: nextLines.length });
      deps.pinChatTail();
      deps.draw();
      return start + nextLines.length;
    }

    const delta = nextLines.length - prior.length;
    deps.chatLines.splice(prior.start, prior.length, ...nextLines);
    renderedToolBlocks.set(callId, { start: prior.start, length: nextLines.length });
    if (delta !== 0) {
      for (const [id, block] of renderedToolBlocks.entries()) {
        if (id === callId || block.start <= prior.start) continue;
        renderedToolBlocks.set(id, { start: block.start + delta, length: block.length });
        const foldId = renderedToolFoldIds.get(id);
        if (foldId) deps.foldStack.shiftStatic(foldId, delta);
      }
    }
    deps.pinChatTail();
    deps.draw();
    return prior.start + nextLines.length;
  };

  const maybeTruncateExpanded = (expanded: string[]): string[] => {
    const max = deps.maxExpandedRows ?? 0;
    if (max <= 0) return expanded;
    const cols = deps.termCols ? deps.termCols() : 80;
    const r = truncateMiddle(expanded, { maxRows: max, termCols: cols });
    return r.lines;
  };

  const recordFoldApplied = (applied: {
    mode: 'kind-unit';
    count: number;
    groupKey: string;
    collapsed: string[];
    expanded: string[];
  }): void => {
    // Line counts: collapsed/expanded arrays are already in scope here, so no extra layer is queried.
    debug.log('log.fold', 'fold-applied', {
      mode: applied.mode,
      count: applied.count,
      groupKey: applied.groupKey,
      collapsedLineCount: applied.collapsed.length,
      expandedLineCount: applied.expanded.length,
    });
  };

  const registerFold = (
    callId: string,
    collapsed: string[],
    expanded: string[] | null,
    grouping?: { operationKind?: string },
  ): void => {
    const operationKind = grouping?.operationKind;
    if (!operationKind) {
      const priorGroup = lastKindGroupId ? kindUnitGroups.get(lastKindGroupId) : undefined;
      if (priorGroup) {
        debug.log('log.fold', 'fold-broken', {
          mode: 'kind-unit',
          groupKey: priorGroup.callIds[0]!,
        });
      }
      lastKindGroupId = null;
      clearFold(callId);
      if (!expanded) return;
      const block = renderedToolBlocks.get(callId);
      if (!block) return;
      const expandedRendered = maybeTruncateExpanded(expanded);
      const foldId = deps.foldStack.push({
        kind: 'static',
        expanded: false,
        lineStart: block.start,
        lineEnd: block.start + collapsed.length,
        rerender: (isExpanded) => isExpanded ? expandedRendered : collapsed,
      });
      renderedToolFoldIds.set(callId, foldId);
      return;
    }

    const block = renderedToolBlocks.get(callId);
    if (!block) return;
    const expandedRendered = expanded ? maybeTruncateExpanded(expanded) : collapsed;
    const lastGroup = lastKindGroupId ? kindUnitGroups.get(lastKindGroupId) : undefined;
    // Same-kind + adjacency already decide coalescing; the original landing's
    // `&& false` had no comment or surviving caller that needed it disabled.
    const adjacentSameKind = lastGroup
      && lastGroup.operationKind === operationKind
      && lastGroup.start + lastGroup.collapsed.length === block.start;

    if (adjacentSameKind && lastGroup) {
      lastGroup.callIds.push(callId);
      lastGroup.expanded.push(...expandedRendered);
      const count = lastGroup.callIds.length;
      const coalesced = [foldKindHint(operationKind, count)];
      const removed = block.length;
      deps.chatLines.splice(block.start, removed);
      renderedToolBlocks.set(callId, { start: lastGroup.start, length: 0 });
      shiftBlocksAfter(block.start, -removed, callId);
      const priorCollapsedLen = lastGroup.collapsed.length;
      deps.chatLines.splice(lastGroup.start, priorCollapsedLen, ...coalesced);
      const collapsedDelta = coalesced.length - priorCollapsedLen;
      lastGroup.collapsed = coalesced;
      if (collapsedDelta !== 0) shiftBlocksAfter(lastGroup.start, collapsedDelta, callId);
      deps.foldStack.remove(lastGroup.foldId);
      const foldId = deps.foldStack.push({
        kind: 'static',
        expanded: false,
        lineStart: lastGroup.start,
        lineEnd: lastGroup.start + lastGroup.collapsed.length,
        rerender: (isExpanded) => isExpanded ? lastGroup.expanded : lastGroup.collapsed,
        mode: 'kind-unit',
        groupKey: lastGroup.callIds[0]!,
      });
      lastGroup.foldId = foldId;
      for (const memberId of lastGroup.callIds) {
        renderedToolFoldIds.set(memberId, foldId);
        callKindGroup.set(memberId, lastKindGroupId!);
      }
      recordFoldApplied({
        mode: 'kind-unit',
        count: lastGroup.callIds.length,
        groupKey: lastGroup.callIds[0]!,
        collapsed: lastGroup.collapsed,
        expanded: lastGroup.expanded,
      });
      deps.pinChatTail();
      deps.draw();
      return;
    }

    clearFold(callId);
    const groupId = `kind-${++kindGroupSeq}`;
    const foldId = deps.foldStack.push({
      kind: 'static',
      expanded: false,
      lineStart: block.start,
      lineEnd: block.start + collapsed.length,
      rerender: (isExpanded) => isExpanded ? expandedRendered : collapsed,
      mode: 'kind-unit',
      groupKey: callId,
    });
    renderedToolFoldIds.set(callId, foldId);
    const created = {
      operationKind,
      callIds: [callId],
      foldId,
      start: block.start,
      collapsed: [...collapsed],
      expanded: [...expandedRendered],
    };
    kindUnitGroups.set(groupId, created);
    callKindGroup.set(callId, groupId);
    lastKindGroupId = groupId;
    recordFoldApplied({
      mode: 'kind-unit',
      count: created.callIds.length,
      groupKey: created.callIds[0]!,
      collapsed: created.collapsed,
      expanded: created.expanded,
    });
  };

  return {
    setArgs: (callId, args) => { renderedToolArgs.set(callId, args); },
    getArgs: (callId) => renderedToolArgs.get(callId),
    deleteArgs: (callId) => { renderedToolArgs.delete(callId); },
    replaceBlock,
    clearFold,
    registerFold,
  };
}
