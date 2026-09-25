// Attachment row metadata registry.
//
// renderAttachmentSummary (dashboard.ts) pushes one chatLines row per
// attachment, formatted as `├─ [Md #3] SMOKE.md (41.9KB)`. Those rows
// carry no structured metadata — they're plain ANSI strings. This
// side-map records which chatLines index produced each attachment row
// so the log-pane mouse handler can detect clicks on them and open the
// attachment popup.
//
// Populate: dashboard.ts:renderAttachmentSummary — after each push,
// call `track(chatLines.length - 1, attachment.id)`.
//
// Invalidate: whenever chatLines is wiped (`/clear`, Ctrl+L,
// `/log clear`), call `clear()`. Line indices are absolute into
// chatLines, so they stay valid across appends — only full wipes
// break them.
//
// Lookup: dashboard mouse handler converts click row → absolute
// chatLines index → `lookup(idx)` → attachment id (or null). Caller
// resolves id via the context registry.

export interface AttachmentRowMap {
  /** Record that `chatLines[lineIdx]` is the attachment-summary row
   *  for attachment `attachmentId`. */
  track(lineIdx: number, attachmentId: number): void;
  /** Return the attachment id at `lineIdx`, or null when the row
   *  doesn't correspond to an attachment. */
  lookup(lineIdx: number): number | null;
  /** Forget every tracked row — call when chatLines is wiped. */
  clear(): void;
  /** Current entry count. Useful for tests + debug logs. */
  size(): number;
  /** Optional — drop a single entry. Used when `/context drop <id>`
   *  removes an attachment so the map doesn't hold a stale pointer.
   *  The chatLines row itself stays (as a history breadcrumb); only
   *  the click target is retired. */
  forgetById(attachmentId: number): number;
}

export function createAttachmentRowMap(): AttachmentRowMap {
  const map = new Map<number, number>();  // lineIdx → attachmentId

  return {
    track(lineIdx, attachmentId) {
      map.set(lineIdx, attachmentId);
    },
    lookup(lineIdx) {
      return map.get(lineIdx) ?? null;
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
    forgetById(attachmentId) {
      let removed = 0;
      for (const [lineIdx, id] of map.entries()) {
        if (id === attachmentId) {
          map.delete(lineIdx);
          removed++;
        }
      }
      return removed;
    },
  };
}
