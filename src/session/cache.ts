// ── Session-scoped tool-call cache (Read / Agent dedup) ──
//
// Goal: smaller models (gpt-5.4-mini) sometimes loop by re-issuing
// identical Read or Agent calls, hoping to get different output.
// Each repeat dumps the same ~60KB of personas.json (or the same
// sub-agent result) into the parent's tool-result history — at
// 14 turns that becomes a 90k-token context bomb and the skill
// aborts with no useful output.
//
// The fix borrows claude-code-fork's tool-result storage pattern:
// after a tool_result exceeds a size threshold, we DON'T need to
// re-transport the full body; a short stub + the advisory "you
// already got this result" forces the LLM to use its existing
// history instead of burning another turn.
//
// Scope: only exact duplicates are suppressed. Changing file_path /
// offset / limit for Read, or description/prompt for Agent, bypasses
// the cache. So targeted re-reads (different window of the same
// file) still work.

import { createHash } from 'node:crypto';
import { debug } from '../debug/log.js';

export interface SessionCacheEntry {
  /** Human description for the debug event ("Read personas.json"). */
  label: string;
  /** Wall-clock ts of the first time we saw this call. */
  firstSeenAt: number;
  /** How many repeat attempts we've deduped. */
  hits: number;
}

/** Threshold for dedup cascade detection. Once cumulative hits across
 *  ALL cached keys reach this count within a single SessionCache
 *  lifetime, the dedup stub escalates to a HALT message (see
 *  dedupeStub / CASCADE_HALT_NOTE). Rationale: the observed failure
 *  mode (log/debug-20260415134119.log) was a parent looping 15+
 *  times on minor label variants of the same Agent spawn, burning 8+
 *  minutes of wall-clock before user abort. Escalating after 5 hits
 *  signals the parent to cut its losses and synthesize. */
export const DEDUP_CASCADE_HALT_THRESHOLD = 5;

/** Threshold for the RUNTIME-LEVEL block on consecutive same-key
 *  tool calls. Observed failure mode (log/debug-20260415151315.log):
 *  gpt-5.4 re-issued Read(personas.json, offset=1, limit=4000) 12
 *  times in a row, ignoring every dedup stub returned as a string.
 *  At 3+ consecutive hits on the IDENTICAL key we escalate: the
 *  dispatcher throws an exception instead of returning a stub, so
 *  the tool_result block carries is_error=true and the model sees
 *  an actual tool FAILURE (not a soft suggestion). This consistently
 *  breaks the reflex-loop pattern where the model isn't reading
 *  stub content. Resets on any distinct key (reading a different
 *  file / spawning a different agent counts as progress). */
export const CONSECUTIVE_DEDUP_BLOCK_THRESHOLD = 3;

/** Per-executeSkill lifetime cache. The parent skill flow creates
 *  one instance at the top of its run and passes it to every tool
 *  dispatcher that wants dedup. Cleared implicitly when the skill
 *  finishes — not module-global so concurrent runs don't collide. */
export class SessionCache {
  private map = new Map<string, SessionCacheEntry>();
  /** Cumulative dedup-hit counter across all keys. Used to detect a
   *  "cascade" — the parent isn't reading the stub and keeps re-trying
   *  the same work under different labels. See DEDUP_CASCADE_HALT_THRESHOLD. */
  private _totalHits = 0;
  /** Last cache key that was HIT (not just seen). Used to detect a
   *  reflex-loop where the parent issues the identical tool call
   *  over and over. See consecutiveHits + CONSECUTIVE_DEDUP_BLOCK_THRESHOLD. */
  private _lastHitKey: string | null = null;
  /** Count of consecutive cache hits on the same key. Reset when
   *  a different key hits OR when noteSeen registers a new entry.
   *  Does NOT reset on mere cache misses against an unrelated key —
   *  only genuine "progress" (new entry registered) breaks the streak. */
  private _consecutiveHits = 0;

  /** Returns the cache entry if this key was seen before, undefined
   *  otherwise. Does NOT insert — call noteSeen() after dispatching
   *  the real tool on miss. */
  check(key: string): SessionCacheEntry | undefined {
    const hit = this.map.get(key);
    if (hit) {
      hit.hits++;
      this._totalHits++;
      if (this._lastHitKey === key) {
        this._consecutiveHits++;
      } else {
        this._lastHitKey = key;
        this._consecutiveHits = 1;
      }
    }
    return hit;
  }

  noteSeen(key: string, label: string): void {
    if (this.map.has(key)) return;
    this.map.set(key, { label, firstSeenAt: Date.now(), hits: 0 });
    // Registering a new cached entry is progress — break the streak.
    this._lastHitKey = null;
    this._consecutiveHits = 0;
  }

  /** Cumulative dedup-hit count across all keys in this session.
   *  Callers compare against DEDUP_CASCADE_HALT_THRESHOLD to decide
   *  whether to promote the dedup stub to a HALT message. */
  get totalHits(): number { return this._totalHits; }

  /** Count of consecutive hits on the SAME key. Callers compare
   *  against CONSECUTIVE_DEDUP_BLOCK_THRESHOLD to decide whether to
   *  escalate from a soft stub to a thrown runtime block. */
  get consecutiveHits(): number { return this._consecutiveHits; }

  /** Which key was last hit — exposed for diagnostic logging. */
  get lastHitKey(): string | null { return this._lastHitKey; }

  get size(): number { return this.map.size; }

  clear(): void {
    this.map.clear();
    this._totalHits = 0;
    this._lastHitKey = null;
    this._consecutiveHits = 0;
  }
}

/** Canonical Read cache key — same file + same window = dedup. */
export function readCacheKey(
  absPath: string,
  offset: number,
  limit: number,
): string {
  return `read:${absPath}:${offset}:${limit}`;
}

/** Agent cache key — hash the full (description + subagent_type +
 *  prompt) so callers can't accidentally miss near-identical calls.
 *  Hash keeps the key bounded even for very long prompts. */
export function agentCacheKey(
  description: string,
  subagentType: string,
  prompt: string,
): string {
  const h = createHash('sha256')
    .update(description)
    .update('\0')
    .update(subagentType)
    .update('\0')
    .update(prompt)
    .digest('hex')
    .slice(0, 16);
  return `agent:${h}`;
}

/** Build the stub tool_result message that replaces the full body
 *  on cache hit. The wording is deliberate: firm enough that the
 *  LLM knows to consult its existing history, but informative so it
 *  can still reason about what's available. */
export function dedupeStub(
  label: string,
  hits: number,
  firstSeenAt: number,
  note: string,
): string {
  const secondsAgo = Math.max(1, Math.round((Date.now() - firstSeenAt) / 1000));
  return (
    `[DUPLICATE CALL — suppressed]\n` +
    `${label}\n` +
    `This exact request was already issued ${secondsAgo}s ago in this session ` +
    `(repeat #${hits}). The previous tool_result is still in your conversation ` +
    `history above; use that instead of calling this tool again.\n\n` +
    `${note}`
  );
}

/** Small helper: callers pass their category (e.g. "tool.read",
 *  "agent.dedup"), a label, and the entry; we emit a single
 *  consistent debug event. Keeps the call sites one-liners. */
export function logDedupHit(
  category: string,
  label: string,
  entry: SessionCacheEntry,
  extra?: Record<string, unknown>,
): void {
  debug.log(category, 'dedup.hit', {
    label,
    hits: entry.hits,
    ageMs: Date.now() - entry.firstSeenAt,
    ...(extra ?? {}),
  });
}
