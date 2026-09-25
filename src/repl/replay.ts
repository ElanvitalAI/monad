// REPL session replay — BACKLOG #5 (2026-05-05).
//
// Converts a previously-recorded session's messages into a `ScenarioTurn[]`
// so the REPL's existing `--scenario` path can re-execute the same user
// prompt sequence against a (possibly different) provider / config / fix.
// Use cases:
//
//   - Bug repro automation: a user reports a problem in session X. Run
//     `monad repl --replay X --new --json` to re-execute the same prompts
//     in a fresh session against the current code, producing a side-by-side
//     comparison without manually re-typing.
//   - Provider comparison: replay against `--rotate opus` after recording
//     under `--rotate codex` (or vice versa) to spot family-specific
//     pathology.
//   - Fix verification: capture a session where some Bug B reproduces, fix
//     the root cause, replay → expect Bug B gone.
//
// Pure helper — extracts user prompts only. Assistant / tool / system
// messages from the original session are intentionally dropped: the
// REPL re-runs the prompts against the dispatcher fresh, which produces
// new assistant + tool messages naturally. Including the originals would
// poison history with assertions about a different run.
//
// Attachments: file paths in the original session may have moved or been
// deleted. v1 ignores attachments and emits a warning so the caller can
// re-attach manually. Future: if `attachments` need to round-trip, store
// content-addressable refs in SerializedMessage and resolve here.

import type { ScenarioTurn } from './index.js';
import type { LoadedSession, SerializedMessage } from '../session/index.js';

export interface ReplayConversion {
  /** Replay turns ready to feed into the REPL `--scenario` path. */
  turns: ScenarioTurn[];
  /** Count of user messages we extracted (== turns.length). */
  extractedCount: number;
  /** Count of assistant/tool/system messages we skipped — informational. */
  skippedCount: number;
  /** Count of user messages whose original turn referenced attachments
   *  that we dropped (we cannot guarantee paths are still valid). */
  droppedAttachmentCount: number;
}

/** Convert a loaded session's messages into REPL replay turns. Pure
 *  function: same input → same output, no side effects.
 *
 *  Empty / non-text user messages are skipped (a session that contains
 *  only tool turns has nothing to replay). The `id` of each emitted
 *  turn is `replay-<index>` so the REPL JSON output can correlate
 *  replay output back to the original prompt order. */
export function buildReplayTurnsFromSession(loaded: LoadedSession): ReplayConversion {
  const turns: ScenarioTurn[] = [];
  let skipped = 0;
  let droppedAttachments = 0;

  for (const msg of loaded.messages) {
    if (!isReplayableUserMessage(msg)) {
      skipped++;
      continue;
    }
    // Heuristic: user messages whose content embeds an attachment marker
    // (e.g. fenced block with file path or base64 image header) are still
    // replayable as text but the attachment file is not preserved here.
    // Mark the count so the caller can warn the user.
    if (looksLikeAttachmentMarker(msg.content)) {
      droppedAttachments++;
    }
    turns.push({
      id: `replay-${turns.length + 1}`,
      prompt: msg.content,
    });
  }

  return {
    turns,
    extractedCount: turns.length,
    skippedCount: skipped,
    droppedAttachmentCount: droppedAttachments,
  };
}

function isReplayableUserMessage(msg: SerializedMessage): boolean {
  if (msg.role !== 'user') return false;
  if (typeof msg.content !== 'string') return false;
  if (msg.content.trim().length === 0) return false;
  return true;
}

/** Cheap content-pattern check for attachment markers. Conservative —
 *  false positives (treating an ordinary fenced block as an attachment)
 *  only inflate the warning count, never block the replay. */
function looksLikeAttachmentMarker(content: string): boolean {
  // Image base64 inline (data URL) or fenced block with explicit file path.
  return content.includes('data:image/')
    || /```[a-zA-Z]*\n.*\b(?:attached|attachment|file_path)\b/i.test(content);
}
