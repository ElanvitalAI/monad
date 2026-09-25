/** Pure lineage decision: which earlier open drafts the merged run supersedes. No I/O, no gh. */

export const LINEAGE_NOT_CLOSED_REASONS = [
  '계보 다름',
  '계보 모름',
  '병합 PR 보다 늦게 열림',
  '병합 PR 자신',
] as const;

export type LineageNotClosedReason = (typeof LINEAGE_NOT_CLOSED_REASONS)[number];

export interface LineageSupersedeMergedRun {
  askFile?: string;
  runId: string;
  prNumber: number;
  openedAt: string;
}

export interface LineageSupersedeOpenDraft {
  number: number;
  runId: string;
  /** Absent when the draft's run ledger has no askFile or could not be read. */
  askFile?: string;
  openedAt: string;
}

export interface LineageSupersedeDecision {
  close: LineageSupersedeOpenDraft[];
  notClosed: Record<LineageNotClosedReason, number>;
}

function emptyNotClosed(): Record<LineageNotClosedReason, number> {
  return {
    '계보 다름': 0,
    '계보 모름': 0,
    '병합 PR 보다 늦게 열림': 0,
    '병합 PR 자신': 0,
  };
}

function openedAtMs(openedAt: string): number | null {
  const ms = Date.parse(openedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Close a draft only when both askFiles are known and equal, the draft is not
 * the merged PR, and the draft opened strictly earlier than the merged PR.
 * Unknown askFile is never the same lineage. A merged run with no askFile closes nothing.
 */
export function decideLineageSupersede(
  merged: LineageSupersedeMergedRun,
  drafts: readonly LineageSupersedeOpenDraft[],
): LineageSupersedeDecision {
  const notClosed = emptyNotClosed();
  if (!merged.askFile) return { close: [], notClosed };
  const mergedOpenedAt = openedAtMs(merged.openedAt);
  const close: LineageSupersedeOpenDraft[] = [];
  for (const draft of drafts) {
    if (draft.number === merged.prNumber) {
      notClosed['병합 PR 자신'] += 1;
      continue;
    }
    if (!draft.askFile) {
      notClosed['계보 모름'] += 1;
      continue;
    }
    if (draft.askFile !== merged.askFile) {
      notClosed['계보 다름'] += 1;
      continue;
    }
    const draftOpenedAt = openedAtMs(draft.openedAt);
    if (mergedOpenedAt === null || draftOpenedAt === null || draftOpenedAt >= mergedOpenedAt) {
      notClosed['병합 PR 보다 늦게 열림'] += 1;
      continue;
    }
    close.push(draft);
  }
  return { close, notClosed };
}

export function lineageSupersedeCloseComment(askFile: string, mergedPrNumber: number): string {
  return `대체됨: 같은 계보(${askFile})의 #${mergedPrNumber} 이 병합됐다`;
}
