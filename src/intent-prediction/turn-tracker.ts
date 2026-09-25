// Intent-prediction · per-session turn tracker.
//
// Bridge between live ACP turn events and the intent ranker's
// IntentContext. Before this module landed (2026-05-09), the
// production wiring fed the ranker a zeroed-out fallback context
// (lastTurnSummary='', idleMs=0, ...) so every tick produced the
// same 6 candidate confidences → SSE never emitted a new ranking →
// the PWA IntentPanel sat frozen on its first frame regardless of
// session activity (user-reported).
//
// v0 (PR #2107) wired `lastTurnSummary` + `idleMs` only. R1 (this
// extension) adds the missing 3 ranker signals so the panel's
// '잠시 멈춤' / 'diff 보여줘' / '승인' weights also respond:
//
//   - `lastErr`        — set on runTurn throw, cleared on next prompt
//   - `fileEditCount`  — incremented on Edit/Write/MultiEdit tool_call
//   - `progressPct`    — derived from turn count (naive 0.1/turn cap 1)
//
// Cross-ref:
//   src/intent-prediction/ranker.ts (consumer)
//   src/nexus/index.ts (production wiring · runNexus)
//   내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.1

const SUMMARY_MAX_CHARS = 240;
const ERROR_MAX_CHARS = 240;

/** Tool names that count as "file edits" for the ranker. Mirrors
 *  the tool surface enum used by `Edit` / `Write` / `MultiEdit`
 *  ACP tool dispatchers. Intentionally narrow — `Read` / `Grep` /
 *  `Glob` are observation tools and should NOT trigger
 *  'diff 보여줘' weight. Case-insensitive match (LLM tool naming
 *  varies: Anthropic uses PascalCase, OpenAI uses snake_case in
 *  some streams). */
const FILE_EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'edit',
  'write',
  'multiedit',
  // Local-LLM equivalents. Best-effort — adopt as the surface
  // grows.
  'str_replace_editor',
  'str_replace_based_edit_tool',
]);

/** Naive progress derivation — every user turn adds this much to
 *  progressPct, capped at 1.0. 10 turns = 100% feels like a
 *  reasonable v0 ceiling for the ranker's '승인' threshold (0.7) to
 *  kick in around turn 7. The number is intentionally a guess — the
 *  ranker re-evaluates each tick so over-shoot just means the user
 *  sees '승인' surface earlier than ideal, not incorrectly. */
const PROGRESS_PER_TURN = 0.1;

export interface TurnRecord {
  /** Truncated text of the last user prompt seen for this session. */
  lastTurnSummary: string;
  /** Milliseconds since the most-recent prompt for this session. */
  idleMs: number;
  /** Last runTurn error message (truncated · cleared on next prompt).
   *  Empty string when no error since the last prompt. */
  lastErr: string;
  /** Number of file-edit tool calls (Edit/Write/MultiEdit) recorded
   *  for this session. Persists across turns within the session — a
   *  long-running session accumulates edits. */
  fileEditCount: number;
  /** Naive progress estimate — `min(1, turnCount * 0.1)`. */
  progressPct: number;
}

export interface TurnTracker {
  /** Record that an ACP prompt arrived for `sessionId`. Updates the
   *  per-session entry: lastTurnSummary = truncated prompt text,
   *  lastPromptTs = now(), turnCount += 1. Clears any prior
   *  `lastErr` (a fresh prompt resets the error gate so a follow-up
   *  prompt that doesn't error doesn't keep '잠시 멈춤' boosted
   *  forever). */
  recordPrompt(sessionId: string, userText: string): void;
  /** Record an error from the most-recent runTurn for `sessionId`.
   *  Truncated at ERROR_MAX_CHARS. Cleared by the next
   *  `recordPrompt`. No-op when sessionId has no prior prompt
   *  entry — errors before any prompt shouldn't materialize, but be
   *  defensive. */
  recordError(sessionId: string, errMsg: string): void;
  /** Record a tool call. Only `FILE_EDIT_TOOL_NAMES` increment the
   *  counter; other tool names are silently ignored. No-op when
   *  sessionId has no prior prompt entry. */
  recordToolUse(sessionId: string, toolName: string): void;
  /** Read the live IntentContext shape for `sessionId`. Returns
   *  `null` when no prompt has been seen yet — the caller (production
   *  intentContextProvider) returns `null` upstream so the ranker
   *  Phase 0.5 server treats the session as un-rankable until the
   *  first turn. */
  read(sessionId: string): TurnRecord | null;
  /** Drop the entry for `sessionId`. Called when the session ends
   *  (loadSession reject / explicit shutdown) so memory doesn't
   *  accumulate over a long-lived daemon. */
  forget(sessionId: string): void;
  /** Test helper — current entry count. Production code should not
   *  rely on this. */
  size(): number;
}

export interface TurnTrackerOpts {
  /** Wall-clock seam. Defaults to Date.now. Tests inject a stepping
   *  clock so idleMs assertions are deterministic. */
  now?: () => number;
}

interface InternalEntry {
  lastTurnSummary: string;
  lastPromptTs: number;
  lastErr: string;
  fileEditCount: number;
  turnCount: number;
}

function clampProgress(turnCount: number): number {
  const raw = turnCount * PROGRESS_PER_TURN;
  if (Number.isNaN(raw) || raw < 0) return 0;
  return raw > 1 ? 1 : raw;
}

export function createTurnTracker(opts: TurnTrackerOpts = {}): TurnTracker {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, InternalEntry>();

  return {
    recordPrompt(sessionId, userText) {
      // Truncate at character boundary — the ranker's tie-breaker
      // looks for substrings ('완료', 'done', '대기', 'waiting'),
      // none longer than SUMMARY_MAX_CHARS, so the cap is safe.
      const trimmed = userText.length > SUMMARY_MAX_CHARS
        ? userText.slice(0, SUMMARY_MAX_CHARS)
        : userText;
      const prior = entries.get(sessionId);
      entries.set(sessionId, {
        lastTurnSummary: trimmed,
        lastPromptTs: now(),
        // Fresh prompt clears prior error — prevents '잠시 멈춤' from
        // sticking after a successful follow-up.
        lastErr: '',
        // fileEditCount persists across turns intentionally — a
        // session accumulates edits and the ranker reads the running
        // total. Reset only on `forget`.
        fileEditCount: prior?.fileEditCount ?? 0,
        turnCount: (prior?.turnCount ?? 0) + 1,
      });
    },
    recordError(sessionId, errMsg) {
      const e = entries.get(sessionId);
      if (!e) return;
      const trimmed = errMsg.length > ERROR_MAX_CHARS
        ? errMsg.slice(0, ERROR_MAX_CHARS)
        : errMsg;
      e.lastErr = trimmed;
    },
    recordToolUse(sessionId, toolName) {
      const e = entries.get(sessionId);
      if (!e) return;
      if (!FILE_EDIT_TOOL_NAMES.has(toolName.toLowerCase())) return;
      e.fileEditCount += 1;
    },
    read(sessionId) {
      const e = entries.get(sessionId);
      if (!e) return null;
      const elapsed = now() - e.lastPromptTs;
      return {
        lastTurnSummary: e.lastTurnSummary,
        idleMs: elapsed < 0 ? 0 : elapsed,
        lastErr: e.lastErr,
        fileEditCount: e.fileEditCount,
        progressPct: clampProgress(e.turnCount),
      };
    },
    forget(sessionId) {
      entries.delete(sessionId);
    },
    size() {
      return entries.size;
    },
  };
}
