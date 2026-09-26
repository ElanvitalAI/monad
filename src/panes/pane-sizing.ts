// ── Shared ratio-row width helpers ──
//
// Yazi keeps pane sizing as a ratio tuple and derives widths from the
// tuple sum. Elanous's dashboard view config already models rows the same
// way (`[{ pane, ratio }]`), so preview width estimates should consume
// that structure directly instead of re-encoding a separate browser /
// scratch formula with ad-hoc caps.

export interface RatioRowPaneSpec {
  pane: string;
  ratio?: number;
}

export interface RatioPaneLayoutRowSpec {
  ratio?: number;
  panes: readonly RatioRowPaneSpec[];
}

export function ratioRowPaneWidths(
  totalCols: number,
  rowPanes: readonly RatioRowPaneSpec[],
  visiblePanes?: ReadonlySet<string>,
): Array<{ pane: string; width: number }> {
  const panes = rowPanes.filter((pane) => !visiblePanes || visiblePanes.has(pane.pane));
  if (panes.length === 0) return [];
  const usable = Math.max(0, totalCols - 1); // mirror layout: reserve 1 col for status column
  const dividers = Math.max(0, panes.length - 1);
  const distributable = Math.max(0, usable - dividers);
  const totalRatio = panes.reduce((sum, pane) => sum + ((typeof pane.ratio === 'number' && pane.ratio > 0) ? pane.ratio : 1), 0) || 1;
  let remainingWidth = distributable;
  let remainingRatio = totalRatio;
  return panes.map((pane, idx) => {
    const ratio = (typeof pane.ratio === 'number' && pane.ratio > 0) ? pane.ratio : 1;
    const width = idx === panes.length - 1
      ? remainingWidth
      : Math.floor((remainingWidth * ratio) / Math.max(1, remainingRatio));
    remainingWidth -= width;
    remainingRatio -= ratio;
    return { pane: pane.pane, width };
  });
}

export function paneWidthForRatioRow(
  totalCols: number,
  rowPanes: readonly RatioRowPaneSpec[],
  targetPane: string,
  visiblePanes?: ReadonlySet<string>,
): number {
  const row = ratioRowPaneWidths(totalCols, rowPanes, visiblePanes);
  const match = row.find((pane) => pane.pane === targetPane);
  return Math.max(20, match?.width ?? 20);
}

export function previewPaneWidthFor(
  totalCols: number,
  rowPanes: readonly RatioRowPaneSpec[],
  visiblePanes?: ReadonlySet<string>,
): number {
  return paneWidthForRatioRow(totalCols, rowPanes, 'preview', visiblePanes);
}

export function ratioLayoutRowHeights(
  totalRows: number,
  rowSpecs: readonly RatioPaneLayoutRowSpec[],
  visiblePanes?: ReadonlySet<string>,
): Array<{ panes: string[]; height: number }> {
  const rows = rowSpecs
    .map((row) => ({
      ratio: row.ratio,
      panes: row.panes
        .filter((pane) => !visiblePanes || visiblePanes.has(pane.pane))
        .map((pane) => pane.pane),
    }))
    .filter((row) => row.panes.length > 0);
  if (rows.length === 0) return [];
  const distributable = Math.max(0, totalRows);
  const totalRatio = rows.reduce((sum, row) => sum + ((typeof row.ratio === 'number' && row.ratio > 0) ? row.ratio : 1), 0) || 1;
  let remainingHeight = distributable;
  let remainingRatio = totalRatio;
  return rows.map((row, idx) => {
    const ratio = (typeof row.ratio === 'number' && row.ratio > 0) ? row.ratio : 1;
    const height = idx === rows.length - 1
      ? remainingHeight
      : Math.floor((remainingHeight * ratio) / Math.max(1, remainingRatio));
    remainingHeight -= height;
    remainingRatio -= ratio;
    return {
      panes: [...row.panes],
      height,
    };
  });
}

export function paneHeightBeforeTargetRow(
  totalRows: number,
  rowSpecs: readonly RatioPaneLayoutRowSpec[],
  targetPane: string,
  visiblePanes?: ReadonlySet<string>,
): number {
  const rows = ratioLayoutRowHeights(totalRows, rowSpecs, visiblePanes);
  const targetIdx = rows.findIndex((row) => row.panes.includes(targetPane));
  if (targetIdx < 0) return rows.reduce((sum, row) => sum + row.height, 0);
  return rows.slice(0, targetIdx).reduce((sum, row) => sum + row.height, 0);
}

export function paneHeightForTargetRows(
  totalRows: number,
  rowSpecs: readonly RatioPaneLayoutRowSpec[],
  targetPane: string,
  visiblePanes?: ReadonlySet<string>,
): number {
  return ratioLayoutRowHeights(totalRows, rowSpecs, visiblePanes)
    .filter((row) => row.panes.includes(targetPane))
    .reduce((sum, row) => sum + row.height, 0);
}
