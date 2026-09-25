// Log-pane click dispatch — U-4.1 (PLAN L-1) externalization.
//
// Consolidates the hit-test + popup-mount logic previously inlined in
// src/dashboard.ts (tryAttachmentHitAtBodyRow + tryHandleLogAreaClick)
// so every dispatcher — streaming / idle mx-mouse / input-mode
// onMouse — calls the same pair of pure helpers.
//
// Five production call sites consume this module:
//
//   1. attachChatStreamingKeys (streaming)   — non-embedded log zone
//   2. mx-mouse no-hit fallback (idle)       — non-embedded log zone
//   3. mx-mouse wd-log hit (idle, embedded)  — tryAttachmentHitAtBodyRow
//   4. textInput.onMouse wd-log hit (input)  — tryAttachmentHitAtBodyRow
//   5. textInput.onMouse log zone (input)    — non-embedded w/ focusOnMiss=false
//
// Design notes:
//
// - Pure DI: no dashboard closures are imported. Every piece of
//   runtime state (term size, scroll offset, freeze index, attachment
//   map, side-effect callbacks) is passed in via `LogClickDispatchDeps`.
//   Makes the helpers unit-testable and callable from future surfaces
//   (wd-log widget's `onMouse` in Phase L-3).
//
// - Debug instrumentation preserved verbatim from the pre-extraction
//   site. Categories:
//     `log-pane.attachment-hittest` — body-row → absIdx decision
//     `log-pane.attachment-click`   — attachment id resolved + popup mounts
//     `log-pane.area-click`         — outer wrapper outcome (focus vs no-attachment)

import type { Attachment, ContextRegistry } from '../context.js';
import type { AttachmentRowMap } from './attachment-row-map.js';
import type { AttachmentPopupAction } from './attachment-popup.js';
import { createAttachmentPopup } from './attachment-popup.js';
import type { ViewSurfaceHandle } from '../ui/modal-adapter.js';

export type LogAreaClickOutcome = 'popup-opened' | 'focused' | 'no-attachment';

export interface LogClickDispatchDeps {
  // ── Layout geometry ──────────────────────────────────────────────
  /** Current terminal rows/cols. */
  termSize(): { rows: number; cols: number };
  /** Grid zone height (panes above the log). */
  computePaneH(rows: number): number;
  /** Log zone height (log area below the grid). */
  computeLogH(rows: number): number;

  // ── Scroll + freeze state ───────────────────────────────────────
  /** `chatLines.length` — number of rendered log entries. */
  chatLinesLength(): number;
  /** Current scroll offset. `-1` means "pinned to tail". */
  chatScrollOffset(): number;
  /** Freeze tail index (set during streaming freeze). `null` when inactive. */
  logFrozenTailIndex(): number | null;
  /** Footer line string (e.g. search match counter). `null`/`''` means no footer. */
  chatFooterLine(): string | null;

  // ── Attachment state ─────────────────────────────────────────────
  attachmentRowMap: AttachmentRowMap;
  contextRegistry: ContextRegistry;
  ownerWorkspaceId?: string;

  // ── Side effects ────────────────────────────────────────────────
  /** Focus shift — called by `tryHandleLogAreaClick` when focusOnMiss is
   *  not `false` and the click didn't land on an attachment row. */
  setWorkingFocus(pane: 'log', reason: string): void;
  /** Wave C — pill cascade. Receives the absolute chatLines index the
   *  click resolved to and returns true when the row is the
   *  background-pill (and the implementation has fired its action,
   *  typically opening the /bg popup). Optional — when omitted the
   *  attachment hit-test runs unchanged. */
  tryPillHit?: (absIdx: number) => boolean;
  /** Fold-toggle cascade. Receives the absolute chatLines index the click
   *  resolved to and returns true when a fold target was toggled.
   *  Optional — when omitted the no-attachment paths run unchanged. */
  tryFoldToggle?: (absIdx: number) => boolean;
  /** Mount the attachment popup on the display modal stack. The dashboard
   *  is responsible for tracking the active handle and disposing the
   *  previous one before mounting a new popup — this prevents popup
   *  pile-up + paint residue (TECH-DEBT-modal-lifecycle-and-paint §1-1
   *  / §1-2). When the §5.2 #14 ModalLifecycle primitive lands, this
   *  responsibility moves into a `PushOpts.idempotencyKey` policy and
   *  this callback shrinks back to `(surface) => void`. */
  pushModal(handle: ViewSurfaceHandle): void;
  /** Popup action handler — invoked by the popup on user pick
   *  (drop / copy-token / copy-path). */
  onAttachmentAction(action: AttachmentPopupAction, attachment: Attachment): void;
  /** Redraw — called after popup action side effects so the dashboard
   *  repaints with the new state. */
  draw(): void;

  // ── Debug ───────────────────────────────────────────────────────
  debug: {
    readonly enabled: boolean;
    log(category: string, msg: string, snap?: Record<string, unknown>): void;
  };
}

/** Core hit-test: given a body-local row (0 = first body row after the
 *  title) and the click's absolute coords for popup anchoring, mount
 *  the popup when the row corresponds to an attachment summary.
 *
 *  Shared between the embedded widget path (where the caller derives
 *  rowInBody from `hitTestLayoutCell.localRow - 1`) and the non-
 *  embedded path (where the caller derives rowInBody from
 *  `clickAbs.row - logStart - 1`). */
export function tryAttachmentHitAtBodyRow(
  rowInBody: number,
  clickAbs: { row: number; col: number },
  deps: LogClickDispatchDeps,
): LogAreaClickOutcome {
  if (rowInBody < 0) return 'no-attachment';
  const { rows: tr } = deps.termSize();
  const sH = deps.computeLogH(tr);
  const bodyH = Math.max(0, sH - 1);
  const footer = deps.chatFooterLine();
  const hasFooter = footer != null && footer !== '';
  const contentH = Math.max(0, bodyH - (hasFooter ? 2 : 0));
  const scroll = deps.chatScrollOffset();
  const frozen = deps.logFrozenTailIndex();
  const chatLen = deps.chatLinesLength();
  const visibleLen = (scroll === -1 ? null : frozen) ?? chatLen;
  const maxScroll = Math.max(0, visibleLen - contentH);
  const start = scroll < 0
    ? maxScroll
    : Math.min(scroll, maxScroll);
  const absIdx = start + rowInBody;
  // Wave C — pill cascade runs ahead of attachment lookup. The pill
  // is exclusive single-row and won't collide with an attachment in
  // normal flow; checking it first keeps the no-attachments path
  // (formerly the early-return at the top of this function) eligible
  // for pill hits too.
  if (deps.tryPillHit?.(absIdx)) return 'popup-opened';
  if (!deps.attachmentRowMap.size()) {
    if (deps.tryFoldToggle?.(absIdx)) return 'popup-opened';
    return 'no-attachment';
  }
  return tryAttachmentHitAtLineIndex(absIdx, clickAbs, deps, {
    rowInBody,
    start,
    scrollOffset: scroll,
  });
}

/** Attachment hit-test against an absolute source line index.
 *
 *  Filtered / transformed views can map a rendered body row back to
 *  the original log line and delegate here without faking scroll math.
 */
export function tryAttachmentHitAtLineIndex(
  absIdx: number,
  clickAbs: { row: number; col: number },
  deps: LogClickDispatchDeps,
  meta: {
    rowInBody?: number;
    start?: number;
    scrollOffset?: number;
  } = {},
): LogAreaClickOutcome {
  const { rows: tr, cols: tc } = deps.termSize();
  const attachmentId = deps.attachmentRowMap.lookup(absIdx);
  if (deps.debug.enabled) {
    deps.debug.log('log-pane.attachment-hittest', `rowInBody=${meta.rowInBody ?? 'n/a'}`, {
      absIdx,
      attachmentId,
      mapSize: deps.attachmentRowMap.size(),
      start: meta.start ?? null,
      scrollOffset: meta.scrollOffset ?? null,
    });
  }
  if (attachmentId === null) {
    if (deps.tryFoldToggle?.(absIdx)) return 'popup-opened';
    return 'no-attachment';
  }
  const attachment = deps.contextRegistry.attachments.get(attachmentId);
  if (!attachment) {
    if (deps.tryFoldToggle?.(absIdx)) return 'popup-opened';
    return 'no-attachment';
  }
  if (deps.debug.enabled) {
    deps.debug.log('log-pane.attachment-click', `id=${attachmentId}`, {
      absRow: clickAbs.row,
      token: attachment.token,
    });
  }
  const popup = createAttachmentPopup({
    attachment,
    ownerWorkspaceId: deps.ownerWorkspaceId,
    col: clickAbs.col,
    row: clickAbs.row,
    termCols: tc,
    termRows: tr,
    onAction: (action, att) => {
      deps.onAttachmentAction(action, att);
      deps.draw();
    },
    onCancel: () => { deps.draw(); },
  });
  // Pass the full handle (not just .surface) so the dashboard can
  // track + dispose the previous popup before pushing this one — the
  // attachment popup pile-up bug (TECH-DEBT §1-1) was caused by
  // dropping the handle here and discarding the dispose entry point.
  deps.pushModal(popup);
  return 'popup-opened';
}

/** Non-embedded log area click — caller has already bounded the click
 *  to the log zone (row range). Computes rowInBody from
 *  `(absRow - logStart - 1)` and delegates to
 *  `tryAttachmentHitAtBodyRow`. When the row is NOT an attachment,
 *  falls through to `setWorkingFocus('log', ...)` unless
 *  `focusOnMiss: false` is specified (input-mode rule — clicks on
 *  plain log rows are swallowed so the input prompt retains focus). */
export function tryHandleLogAreaClick(
  m: { row: number; col: number; type: string },
  deps: LogClickDispatchDeps,
  opts: { focusOnMiss?: boolean } = { focusOnMiss: true },
): LogAreaClickOutcome {
  const { rows: tr } = deps.termSize();
  const pH = deps.computePaneH(tr);
  const logStart = pH + 1;
  const rowInBody = m.row - (logStart + 1);  // 0 = first body row; title row → -1
  const outcome = tryAttachmentHitAtBodyRow(rowInBody, m, deps);
  if (outcome === 'popup-opened') return outcome;
  if (deps.debug.enabled) {
    deps.debug.log('log-pane.area-click', `row=${m.row}`, {
      rowInBody,
      attachmentMapSize: deps.attachmentRowMap.size(),
      focusOnMiss: opts.focusOnMiss !== false,
    });
  }
  if (opts.focusOnMiss === false) return 'no-attachment';
  deps.setWorkingFocus('log', 'log-area-click');
  return 'focused';
}
