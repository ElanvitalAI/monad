// ACP session store — maps (chatId, backendId) → ACP sessionId so
// a messenger chat keeps its conversation across multiple turns.
//
// Persistence: a single JSON file at ~/.config/monad/acp-sessions.json.
// The file is a flat array of records; load is a single read + parse
// on startup, save rewrites the whole file (atomic via tmp+rename).
// For the session counts we expect (a few dozen chats × a few
// backends), a plain file beats sqlite on setup cost and debug-ability.
//
// Restart semantics (S5 · 2026-07-12 — 구 "restart = reset" v1 한계 해소):
//   - codex: cheap thread/resume re-attach ⇒ sessions survive restarts.
//   - claude: SMALL known-size sessions (turnCount ≤
//     ACP_CROSS_RESTART_RESUME_MAX_TURNS) get a time-boxed loadSession
//     resume across restarts; large/unknown-size ones recycle eagerly
//     (full-transcript replay would be 60s+). See turn-runner
//     resolveSessionId ①.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { migrateLegacyXdgFile } from '../storage/legacy-monad-dir-migrate.js';
import { canonicalizeBackendId } from './backend-registry.js';

/** Discord snowflakes are 17-19 digits — outside JS Number's safe
 *  integer range. We accept string or number at the API boundary,
 *  normalize to string internally, and persist as strings so
 *  per-messenger ID shapes don't leak. Telegram callers pass
 *  numbers; Discord callers pass strings; both land in the same
 *  store transparently. */
export type ChatKey = string | number;

function toKey(v: ChatKey | undefined): string | undefined {
  if (v === undefined) return undefined;
  return String(v);
}

/** Per-process boot id. A record carrying a DIFFERENT (or absent) epoch
 *  was minted by a PRIOR daemon process — resuming it would force the
 *  backend to loadSession-replay its whole transcript (O(session size) —
 *  60s+ for a big session). The resolver treats a non-matching epoch as
 *  stale and starts fresh instead ("restart = reset", the original v1
 *  intent). Absent epoch (records written before bounding existed) also
 *  reads as stale, so pre-existing bloated sessions self-heal on first
 *  touch. */
export const ACP_SESSION_EPOCH = `${process.pid}-${Date.now()}`;

interface AcpSessionRecord {
  /** Canonical string form. Legacy records written when this field
   *  was typed as number get coerced on load via String(). */
  chatId: string;
  threadId?: string;
  backendId: string;
  sessionId: string;
  /** ISO timestamp for TTL / debugging. */
  updatedAt: string;
  /** Boot id of the process that minted this session. Absent on records
   *  written before bounding existed → treated as stale (recycled). */
  mintedEpoch?: string;
  /** Turns run on this session. Bounds growth: past a cap the resolver
   *  recycles it (fresh mint) so loadSession replay stays cheap and the
   *  backend's context can't balloon. Absent = 0. */
  turnCount?: number;
}

/** Default path: ~/.monad/acp-sessions.json (canonical · 2026-05-10).
 *  XDG_CONFIG_HOME explicit honors legacy ~/.config/monad/acp-sessions.json.
 *  FU2 (PLAN closing follow-up): first call migrates legacy file. */
function defaultStorePath(): string {
  // MONAD_STATE_DIR — unified isolated-state knob (see sessionRoot). Wins
  // over XDG so an isolated process's chat→ACP-session map stays separate.
  const stateDir = process.env.MONAD_STATE_DIR?.trim();
  if (stateDir) return joinPath(stateDir, 'acp-sessions.json');
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return joinPath(xdg, 'monad', 'acp-sessions.json');
  migrateLegacyXdgFile('acp-sessions.json', 0o600);
  // MONAD_STATE_DIR 부재 확정(위 early-return) → monadStateRoot()=~/.monad (prod 동치).
  return joinPath(monadStateRoot(), 'acp-sessions.json');
}

function readRecords(path: string): AcpSessionRecord[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — drop malformed entries rather than throwing,
    // so one bad row written by a crashed bot doesn't brick startup.
    const records: AcpSessionRecord[] = [];
    for (const r of parsed) {
      if (typeof r !== 'object' || r === null) continue;
      const raw = r as Record<string, unknown>;
      // Accept either string or number for chatId/threadId so records
      // written before the Discord migration still load. Coerce to
      // string for the normalized in-memory form.
      const chatIdRaw = raw.chatId;
      if (typeof chatIdRaw !== 'string' && typeof chatIdRaw !== 'number') continue;
      if (typeof raw.backendId !== 'string') continue;
      if (typeof raw.sessionId !== 'string') continue;
      if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) continue;
      records.push({
        chatId: String(chatIdRaw),
        threadId: raw.threadId !== undefined && raw.threadId !== null
          ? String(raw.threadId) : undefined,
        backendId: raw.backendId,
        sessionId: raw.sessionId,
        updatedAt: raw.updatedAt,
        ...(typeof raw.mintedEpoch === 'string' ? { mintedEpoch: raw.mintedEpoch } : {}),
        ...(typeof raw.turnCount === 'number' ? { turnCount: raw.turnCount } : {}),
      });
    }
    return records;
  } catch {
    // Corrupt file — treat as empty. Safer than crashing the bot on
    // startup over a disk write that got interrupted.
    return [];
  }
}

function writeRecords(path: string, records: AcpSessionRecord[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Atomic write: tmp + rename. Prevents a half-written file from
  // being loaded on the next read if the bot crashes mid-save.
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
  renameSync(tmp, path);
}

function sameKey(a: AcpSessionRecord, chatId: string, threadId: string | undefined, backendId: string): boolean {
  return a.chatId === chatId
    && canonicalizeBackendId(a.backendId) === canonicalizeBackendId(backendId)
    && (a.threadId ?? undefined) === threadId;
}

function recordKey(record: AcpSessionRecord): string {
  return `${record.chatId}\0${record.threadId ?? ''}\0${canonicalizeBackendId(record.backendId)}`;
}

/** Prefer the canonical spelling when an old alias and its canonical
 * backend id coexist. Within either spelling, choose the latest record;
 * sessionId breaks timestamp ties so selection never depends on file order. */
function preferredRecord(a: AcpSessionRecord, b: AcpSessionRecord): AcpSessionRecord {
  const canonical = canonicalizeBackendId(a.backendId);
  const aCanonical = a.backendId === canonical;
  const bCanonical = b.backendId === canonical;
  if (aCanonical !== bCanonical) return aCanonical ? a : b;
  const aUpdatedAt = Date.parse(a.updatedAt);
  const bUpdatedAt = Date.parse(b.updatedAt);
  if (aUpdatedAt !== bUpdatedAt) return aUpdatedAt > bUpdatedAt ? a : b;
  return a.sessionId >= b.sessionId ? a : b;
}

/** Normalize legacy aliases and collapse duplicate logical keys on load.
 * Persisting the compacted result prevents future reads from reintroducing
 * file-order-dependent session selection. */
function compactRecords(records: AcpSessionRecord[]): AcpSessionRecord[] {
  const selected = new Map<string, AcpSessionRecord>();
  for (const record of records) {
    const key = recordKey(record);
    const current = selected.get(key);
    if (!current) {
      selected.set(key, record);
    } else {
      selected.set(key, preferredRecord(current, record));
    }
  }
  return Array.from(selected.values(), (record) => ({
    ...record,
    backendId: canonicalizeBackendId(record.backendId),
  }));
}

/** UI-Core arc Phase U1 — narrow change event for SessionStore facade
 *  subscription. threadId omitted when undefined. */
export type AcpChatSessionStoreChangeEvent =
  | { kind: 'chat-mapping-set'; chatId: string; backendId: string; sessionId: string; threadId?: string }
  | { kind: 'chat-mapping-deleted'; chatId: string; backendId: string; threadId?: string };

export class AcpSessionStore {
  private records: AcpSessionRecord[];
  private changeListeners = new Set<(ev: AcpChatSessionStoreChangeEvent) => void>();
  constructor(private readonly path: string = defaultStorePath()) {
    const loaded = readRecords(path);
    this.records = compactRecords(loaded);
    const normalized = loaded.some((record) => record.backendId !== canonicalizeBackendId(record.backendId));
    if (this.records.length !== loaded.length || normalized) writeRecords(path, this.records);
  }

  /** Look up an existing sessionId. Returns null if no record. */
  get(chatId: ChatKey, backendId: string, threadId?: ChatKey): string | null {
    const c = toKey(chatId)!;
    const t = toKey(threadId);
    const found = this.records.find(r => sameKey(r, c, t, backendId));
    return found?.sessionId ?? null;
  }

  /** Upsert — overwrites any existing record for the same key. */
  set(chatId: ChatKey, backendId: string, sessionId: string, threadId?: ChatKey): void {
    const c = toKey(chatId)!;
    const t = toKey(threadId);
    const idx = this.records.findIndex(r => sameKey(r, c, t, backendId));
    // A `set` = a freshly minted session → stamp THIS process's epoch and
    // reset the turn counter, so bounding starts clean.
    const record: AcpSessionRecord = {
      chatId: c,
      threadId: t,
      backendId,
      sessionId,
      updatedAt: new Date().toISOString(),
      mintedEpoch: ACP_SESSION_EPOCH,
      turnCount: 0,
    };
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    writeRecords(this.path, this.records);
    const ev: AcpChatSessionStoreChangeEvent = {
      kind: 'chat-mapping-set',
      chatId: c,
      backendId,
      sessionId,
    };
    if (t !== undefined) ev.threadId = t;
    this.fireChange(ev);
  }

  /** Full record for this chat+backend (or null). Exposes mintedEpoch +
   *  turnCount so the resolver can decide whether to resume or recycle. */
  getRecord(chatId: ChatKey, backendId: string, threadId?: ChatKey): AcpSessionRecord | null {
    const c = toKey(chatId)!;
    const t = toKey(threadId);
    return this.records.find(r => sameKey(r, c, t, backendId)) ?? null;
  }

  /** Increment the turn counter for this chat+backend (no-op if no
   *  record). Called once per completed turn so the resolver can recycle
   *  a session that has grown past the cap. */
  bumpTurn(chatId: ChatKey, backendId: string, threadId?: ChatKey): void {
    const c = toKey(chatId)!;
    const t = toKey(threadId);
    const rec = this.records.find(r => sameKey(r, c, t, backendId));
    if (!rec) return;
    rec.turnCount = (rec.turnCount ?? 0) + 1;
    rec.updatedAt = new Date().toISOString();
    writeRecords(this.path, this.records);
  }

  /** Drop the stored sessionId for this chat+backend. Returns true
   *  when something was removed, false if no record existed. */
  delete(chatId: ChatKey, backendId: string, threadId?: ChatKey): boolean {
    const c = toKey(chatId)!;
    const t = toKey(threadId);
    const idx = this.records.findIndex(r => sameKey(r, c, t, backendId));
    if (idx < 0) return false;
    this.records.splice(idx, 1);
    writeRecords(this.path, this.records);
    const ev: AcpChatSessionStoreChangeEvent = {
      kind: 'chat-mapping-deleted',
      chatId: c,
      backendId,
    };
    if (t !== undefined) ev.threadId = t;
    this.fireChange(ev);
    return true;
  }

  /** List all records — debugging + admin ops. */
  list(): readonly AcpSessionRecord[] {
    return this.records;
  }

  /** UI-Core arc Phase U1 — subscribe to set/delete events. Returns
   *  unsubscribe fn. Errors in listeners are swallowed so one bad
   *  consumer can't wedge others. */
  onChange(listener: (ev: AcpChatSessionStoreChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  private fireChange(ev: AcpChatSessionStoreChangeEvent): void {
    for (const l of Array.from(this.changeListeners)) {
      try { l(ev); } catch { /* listener errors must not wedge others */ }
    }
  }
}

export type { AcpSessionRecord };

/** Process-wide singleton, constructed on first import. Override the
 *  path in tests by instantiating AcpSessionStore directly with a
 *  tmp-dir path. */
let _store: AcpSessionStore | null = null;
export function globalAcpSessionStore(): AcpSessionStore {
  if (!_store) _store = new AcpSessionStore();
  return _store;
}

/** Reset the cached singleton — for tests only. */
export function _resetAcpSessionStoreForTests(): void {
  _store = null;
}
