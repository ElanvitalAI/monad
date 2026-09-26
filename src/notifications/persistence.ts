// ── NotificationPersistence (NT-E2) ──
//
// Append-only on-disk log for NotificationStore events so the bell
// modal can replay the recent history on the next process launch.
// Session N landed the in-memory store; this adds a thin sidecar:
//
//   ~/.elanous/notifications/<sid>.jsonl  (one event per line)
//
// Design choices:
//  - Per-session files — easy to truncate or delete when a session is
//    retired, and avoids contention on one global log from many
//    concurrently active sessions.
//  - JSONL (newline-delimited JSON) — cheap append via fs.appendFile,
//    trivial replay with split('\n'), corrupt lines are individually
//    skippable.
//  - Cap at persist time: when a file grows past `fileMaxLines`, the
//    oldest half is rewritten away. Matches the in-memory ring-buffer
//    model — history is audit, not archive.
//  - Synchronous API for startup replay; appends are async + fire-
//    and-forget so the hot notification push path stays cheap.
//  - Optional — PersistenceAdapter is injected into the store. When
//    absent, the store behaves exactly as in session N.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';

import type { NotificationEvent } from './store.js';

export interface PersistenceOpts {
  /** Root directory. Defaults to `~/.elanous/notifications`. `null`
   *  disables persistence (used in tests that want the shape without
   *  I/O). */
  dir?: string | null;
  /** Rolling cap per session file. Default 200 — large enough to
   *  cover multiple bell-modal replays, small enough to keep rewrite
   *  cheap. */
  fileMaxLines?: number;
}

const DEFAULT_FILE_CAP = 200;

export interface PersistenceAdapter {
  /** Append an event to the session's log. Fire-and-forget — errors
   *  are swallowed so pushes never throw. */
  append(event: NotificationEvent): void;
  /** Synchronously read every persisted event for `sessionId`. */
  readSession(sessionId: string): NotificationEvent[];
  /** Synchronously read every event across every session file — used
   *  at startup to seed NotificationStore. Returned in ts order. */
  readAll(): NotificationEvent[];
  /** Remove the session's log (e.g. after explicit clear). */
  dropSession(sessionId: string): void;
  /** Expose the resolved directory — `null` when disabled. */
  directory(): string | null;
}

/** Construct the default file-system-backed adapter. Returns a
 *  no-op adapter when `dir: null`. */
export function createPersistence(opts: PersistenceOpts = {}): PersistenceAdapter {
  const dir = opts.dir === null
    ? null
    : (opts.dir ?? path.join(elanousStateRoot(), 'notifications'));
  const cap = opts.fileMaxLines ?? DEFAULT_FILE_CAP;
  if (dir === null) return noopAdapter();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* swallow */ }
  return {
    append(event) {
      const file = sessionFile(dir, event.sessionId);
      try {
        fs.appendFileSync(file, serialize(event) + '\n', 'utf8');
        trimIfOversize(file, cap);
      } catch { /* swallow — notifications must never crash the push path */ }
    },
    readSession(sessionId) {
      return readFile(sessionFile(dir, sessionId));
    },
    readAll() {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      } catch {
        return [];
      }
      const all: NotificationEvent[] = [];
      for (const name of entries) {
        all.push(...readFile(path.join(dir, name)));
      }
      all.sort((a, b) => a.ts - b.ts);
      return all;
    },
    dropSession(sessionId) {
      const file = sessionFile(dir, sessionId);
      try { fs.unlinkSync(file); } catch { /* missing file is fine */ }
    },
    directory() { return dir; },
  };
}

function noopAdapter(): PersistenceAdapter {
  return {
    append() { /* no-op */ },
    readSession() { return []; },
    readAll() { return []; },
    dropSession() { /* no-op */ },
    directory() { return null; },
  };
}

/** Escape sessionId for filesystem safety — `:` / `/` / `\\` → `_`.
 *  Session ids like `term:1` or `ssh:host/path` must still resolve
 *  to one file per session without traversal tricks. */
function safeName(sessionId: string): string {
  return sessionId.replace(/[^\w.-]/g, '_');
}

function sessionFile(dir: string, sessionId: string): string {
  return path.join(dir, `${safeName(sessionId)}.jsonl`);
}

function serialize(event: NotificationEvent): string {
  // Include only fields the store understands on replay — read flag
  // is intentionally persisted false-ish so old events don't burst
  // the unread count on next launch. Adjust if a future session
  // wants "remembered read".
  const { id, sessionId, kind, ts, title, body, meta } = event;
  return JSON.stringify({ id, sessionId, kind, ts, title, body, meta, read: true });
}

function readFile(file: string): NotificationEvent[] {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out: NotificationEvent[] = [];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw) as NotificationEvent;
      // Defensive — drop anything that doesn't look like our shape.
      if (!parsed.id || !parsed.sessionId || !parsed.kind || !parsed.title) continue;
      out.push(parsed);
    } catch { /* skip corrupt line */ }
  }
  return out;
}

/** Trim the file to `cap` lines when it grows past 2× cap — rewrite
 *  cost amortises across many appends that way. */
function trimIfOversize(file: string, cap: number): void {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return; }
  // Rough byte-based guard to avoid reading every single file on
  // every append. Only open + line-count when the file is at least
  // 4 KB, which is already an order of magnitude above the expected
  // steady state.
  if (stat.size < 4 * 1024) return;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length <= cap * 2) return;
  const kept = lines.slice(lines.length - cap);
  try { fs.writeFileSync(file, kept.join('\n') + '\n', 'utf8'); } catch { /* swallow */ }
}
