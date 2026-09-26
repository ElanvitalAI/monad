// ── T2 + X1 (Phase 1) — Production wiring for terminal-intent consumers ──
//
// Bridges the placeholder consumer chain (caret-focus / word-select /
// range-select / context-menu / viewport-scroll) to real dashboard
// effects:
//   • word-select  → buffer extract → clipboard write + chat preview
//   • range-select → buffer extract (multi-line) → clipboard + chat
//   • caret-focus  → push (row, col) into caret-context store for the
//                    next prompt builder
//   • context-menu → fire `onChooseAtCoordinate` (chooser launch
//                    integration is a follow-up arc)
//   • viewport-scroll → fire `onScrollPane` (scrollback wiring is a
//                    follow-up arc)
//
// Per HANDOFF §5 T2 detail this file is the place where T2's "real
// behavior" lives; the consumers stay capability-gate-only so the
// substrate Layer 2 vocabulary doesn't leak into product code.
//
// Late-binding: the consumer chain is wired during dashboard boot
// before clipboard / chat helpers exist (those depend on later-init
// runtimes). The dashboard creates this runtime *after* those
// helpers, then connects it via `attachToConsumers()`.

import type { SerializableSurfaceIntent } from '../terminal-surface-intent.js';
import type { RangeSelectSpec } from '../terminal-intent-consumers/range-select.consumer.js';
import {
  extractRange,
  extractWordAt,
  type SurfaceMultiLineRange,
  type SurfaceTextRange,
} from './surface-text-extractor.js';
import type { CaretContextStore } from './caret-context-store.js';

export interface PfcMouseActionRuntimeDeps {
  /** Buffer-line lookup keyed by surfaceId. Returns null when the
   *  surface is unknown / has no buffer (e.g. external-terminal where
   *  elanous doesn't own the rendered text). */
  resolveBuffer: (surfaceId: string) => readonly string[] | null;
  /** Clipboard write (typically `clipboardActions.copyText`). Returns
   *  true on success, false on failure. */
  writeClipboard: (text: string) => Promise<boolean>;
  /** Push a chat-line (typically `pushMutedLine`). */
  pushChatLine: (line: string) => void;
  /** Caret context store (T2 caret-focus). */
  caretStore: CaretContextStore;
  /** Optional: fired on `context-menu` intent — production wiring
   *  opens the mouse-action-recipes chooser anchored at (row, col).
   *  Left as a callback so this file stays decoupled from the picker
   *  substrate. */
  onContextMenu?: (intent: SerializableSurfaceIntent) => void;
  /** Optional: fired on `viewport-scroll` intent. */
  onScrollPane?: (intent: SerializableSurfaceIntent) => void;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Cap chat-line preview length so a 200-line range doesn't blast
   *  the chat log. Default 80 chars. */
  previewMaxLength?: number;
}

export interface PfcMouseActionRuntime {
  onCaretFocus(intent: SerializableSurfaceIntent): void;
  onWordSelect(intent: SerializableSurfaceIntent): void;
  onRangeSelect(spec: RangeSelectSpec): void;
  onContextMenu(intent: SerializableSurfaceIntent): void;
  onViewportScroll(intent: SerializableSurfaceIntent): void;
}

const DEFAULT_PREVIEW_MAX = 80;

function preview(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}

export function createPfcMouseActionRuntime(
  deps: PfcMouseActionRuntimeDeps,
): PfcMouseActionRuntime {
  const previewMax = deps.previewMaxLength ?? DEFAULT_PREVIEW_MAX;

  const handleWord = (
    intent: SerializableSurfaceIntent,
    extracted: SurfaceTextRange,
  ): void => {
    void deps.writeClipboard(extracted.text).then((ok) => {
      if (ok) {
        deps.pushChatLine(
          `📋 word "${preview(extracted.text, previewMax)}" copied · ${intent.surfaceId} r${intent.row}c${intent.col}`,
        );
      } else {
        deps.pushChatLine(
          `⚠️ clipboard write failed — word "${preview(extracted.text, previewMax)}" not copied`,
        );
      }
    });
    if (deps.logDebug) {
      deps.logDebug('terminal.intent.word-select.action', intent.surfaceId, {
        word: extracted.text,
        startCol: extracted.startCol,
        endCol: extracted.endCol,
      });
    }
  };

  const handleRange = (
    spec: RangeSelectSpec,
    extracted: SurfaceMultiLineRange,
  ): void => {
    void deps.writeClipboard(extracted.text).then((ok) => {
      const summary = extracted.lineCount > 1
        ? `${extracted.lineCount} lines (${extracted.text.length} chars)`
        : `"${preview(extracted.text, previewMax)}"`;
      if (ok) {
        deps.pushChatLine(`📋 range ${summary} copied · ${spec.surfaceId}`);
      } else {
        deps.pushChatLine(`⚠️ clipboard write failed — range (${extracted.lineCount} lines) not copied`);
      }
    });
    if (deps.logDebug) {
      deps.logDebug('terminal.intent.range-select.action', spec.surfaceId, {
        lineCount: extracted.lineCount,
        bytes: extracted.text.length,
      });
    }
  };

  return {
    onCaretFocus(intent) {
      deps.caretStore.push({
        surfaceId: intent.surfaceId,
        paneKind: intent.paneKind,
        row: intent.row,
        col: intent.col,
        at: Date.now(),
      });
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.caret-focus.action', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
        });
      }
    },

    onWordSelect(intent) {
      const buffer = deps.resolveBuffer(intent.surfaceId);
      if (!buffer) {
        deps.pushChatLine(
          `🐭 word-select armed at ${intent.surfaceId} r${intent.row}c${intent.col} — buffer unavailable for this surface kind`,
        );
        return;
      }
      const extracted = extractWordAt(buffer, intent.row, intent.col);
      if (!extracted) {
        if (deps.logDebug) {
          deps.logDebug('terminal.intent.word-select.no-word', intent.surfaceId, {
            row: intent.row,
            col: intent.col,
          });
        }
        return;
      }
      handleWord(intent, extracted);
    },

    onRangeSelect(spec) {
      const buffer = deps.resolveBuffer(spec.surfaceId);
      if (!buffer) {
        deps.pushChatLine(
          `🐭 range-select armed at ${spec.surfaceId} — buffer unavailable for this surface kind`,
        );
        return;
      }
      const extracted = extractRange(buffer, {
        startRow: spec.startRow,
        startCol: spec.startCol,
        endRow: spec.endRow,
        endCol: spec.endCol,
      });
      if (!extracted) {
        if (deps.logDebug) {
          deps.logDebug('terminal.intent.range-select.empty', spec.surfaceId);
        }
        return;
      }
      handleRange(spec, extracted);
    },

    onContextMenu(intent) {
      try { deps.onContextMenu?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.context-menu.action', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
        });
      }
    },

    onViewportScroll(intent) {
      try { deps.onScrollPane?.(intent); } catch { /* isolate */ }
      if (deps.logDebug) {
        deps.logDebug('terminal.intent.viewport-scroll.action', intent.surfaceId, {
          row: intent.row,
          col: intent.col,
        });
      }
    },
  };
}
