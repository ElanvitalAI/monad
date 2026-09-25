import { debug } from '../../debug/log.js';
import { foldHint, type FoldMode } from '../../log-entry.js';
import { toolHeader, toolResult } from '../../render.js';
import type { ToolRenderModel } from './types.js';

const PERSISTED_REF_PREFIX = '... Full output saved to ';
const LISTING_TOOL_MAX_LINES = 8;

interface ToolBlockLineBudget {
  maxLines: number;
  source: 'caller' | 'listing';
}

export function resolveToolBlockLineBudget(
  model: ToolRenderModel,
  maxLines: number,
  foldMode: FoldMode = 'line',
): ToolBlockLineBudget {
  if (
    (foldMode === 'task-unit' || foldMode === 'kind-unit')
    && Number.isFinite(maxLines)
  ) {
    // One visible slot: empty/one-line bodies stay unmarked; multi-line
    // bodies keep no content and spend the slot on foldHint (see truncate).
    // kind-unit reuses this short budget, then adds adjacent grouping.
    return { maxLines: 1, source: 'caller' };
  }
  if (
    model.kind === 'Glob'
    || model.kind === 'ListDir'
    || model.kind === 'Grep'
    || model.kind === 'WebSearch'
  ) {
    return {
      maxLines: Math.min(maxLines, LISTING_TOOL_MAX_LINES),
      source: LISTING_TOOL_MAX_LINES < maxLines ? 'listing' : 'caller',
    };
  }
  return { maxLines, source: 'caller' };
}

export function renderToolBlock(
  model: ToolRenderModel,
  maxLines: number,
  foldMode: FoldMode = 'line',
  expandHint?: boolean,
): string[] {
  const budget = resolveToolBlockLineBudget(model, maxLines, foldMode);
  const isCollapsed = model.bodyLines.length > budget.maxLines;
  const summary = isCollapsed && model.collapsedSummary
    ? `${model.summary} — ${model.collapsedSummary}`
    : model.summary;
  const header = toolHeader(
    model.kind,
    summary,
    model.status === 'error' ? 'error' : 'success',
  );
  const body = truncateBlockBody(model.bodyLines, budget.maxLines, foldMode, expandHint);
  return [header, ...toolResult(body.join('\n')).split('\n')];
}

/** kind-unit grouping identity carried next to the rendered lines; omitted in other modes. */
export function toolBlockGrouping(model: ToolRenderModel, foldMode: FoldMode = 'line'): {
  operationKind?: string;
} {
  if (foldMode !== 'kind-unit' || !model.operationKind) return {};
  return { operationKind: model.operationKind };
}

function truncateBlockBody(
  lines: string[],
  maxLines: number,
  foldMode: FoldMode = 'line',
  expandHint?: boolean,
): string[] {
  const hint = (hidden: number): string => foldHint('line', hidden, { expandHint });
  if (
    (foldMode === 'task-unit' || foldMode === 'kind-unit')
    && Number.isFinite(maxLines)
    && lines.length > 1
  ) {
    // No aggregation key is available without changing the function contract.
    debug.log('log.fold', 'fold-applied', {
      mode: foldMode,
      preFoldLineCount: lines.length,
      postFoldLineCount: 1,
    });
    return [hint(lines.length)];
  }
  if (lines.length <= maxLines) return lines;
  const persistedRef = lines.find((line) => line.startsWith(PERSISTED_REF_PREFIX));
  if (persistedRef && maxLines >= 2) {
    const head = lines.slice(0, Math.max(0, maxLines - 2));
    const hidden = lines.length - head.length - 1;
    // No aggregation key is available without changing the function contract.
    debug.log('log.fold', 'fold-applied', {
      mode: foldMode,
      preFoldLineCount: lines.length,
      postFoldLineCount: head.length + 2,
    });
    return [
      ...head,
      hint(hidden),
      persistedRef,
    ];
  }
  const kept = lines.slice(0, Math.max(0, maxLines - 1));
  // No aggregation key is available without changing the function contract.
  debug.log('log.fold', 'fold-applied', {
    mode: foldMode,
    preFoldLineCount: lines.length,
    postFoldLineCount: kept.length + 1,
  });
  return [...kept, hint(lines.length - kept.length)];
}
