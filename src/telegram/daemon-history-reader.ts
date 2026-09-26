// Tier 1 telegram fan-out arc — PR 3 · daemon history reader.
//
// Reads message history for a daemon-side sessionId from the disk
// jsonl directly, bypassing the unix-socket ACP path (which doesn't
// expose history fetch yet — BACKLOG #3 tracks the cleaner RPC
// option, but that's bigger scope than this arc).
//
// The reader is the bridge between two pieces already on disk:
//   1. `~/.elanous/elanous.runtime.json` (elanous-daemon.ts) — the daemon
//      writes its `historyDir` here on boot when ELANOUS_HISTORY_DIR
//      is set. This is the discovery path so the telegram bot
//      (running as the same user, on the same host) can find the
//      history dir without a separate config flag.
//   2. `<historyDir>/<sessionId>.jsonl` (daemon-runtime.ts:138) —
//      append-only message log. We tail-read the last N messages
//      for replay preview.
//
// Both paths are local-only — cross-host /resume is out of scope
// for the Tier 1 arc. RESEARCH §C.6 (multi-account) and gateway
// abstraction work will eventually move this behind a transport-
// agnostic "session catalog" RPC.

import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { readElanousDaemonRuntime } from '../elanous-daemon.js';
import type { LLMMessage } from '../llm.js';

export interface DaemonHistoryReadResult {
  /** Messages in chronological order. Empty for an unknown / empty
   *  session. Use `exists` to disambiguate "no daemon" from "empty". */
  messages: LLMMessage[];
  /** Whether the jsonl file existed for this sessionId. False for
   *  unknown ids — caller renders "✗ unknown daemon session". */
  exists: boolean;
  /** historyDir the read came from. Useful for diagnostics — surface
   *  to the user when /resume fails so they can verify the daemon
   *  picked up ELANOUS_HISTORY_DIR. */
  historyDir?: string;
}

/** Read a daemon session's history from local disk.
 *
 *  Returns `{ exists: false }` when:
 *  - the daemon runtime metadata is missing (no daemon ever booted)
 *  - the daemon ran in-memory only (no historyDir set)
 *  - the sessionId's jsonl file doesn't exist under historyDir
 *
 *  Path-traversal defense matches DaemonSessionHistory.diskPathFor
 *  (daemon-runtime.ts:122-132) — sessionIds containing `/`, `\`, or
 *  `..` are rejected. This is a safety net since ACP-minted ids
 *  (`elanous-session-N`, `http-<ts>-<rand>`) never include separators. */
export function readDaemonSessionHistory(sessionId: string): DaemonHistoryReadResult {
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    sessionId.includes('/') ||
    sessionId.includes('\\') ||
    sessionId.includes('..')
  ) {
    return { messages: [], exists: false };
  }

  const runtime = readElanousDaemonRuntime();
  const historyDir = runtime?.historyDir;
  if (!historyDir) return { messages: [], exists: false };

  const path = joinPath(historyDir, `${sessionId}.jsonl`);
  if (!existsSync(path)) {
    return { messages: [], exists: false, historyDir };
  }

  const messages: LLMMessage[] = [];
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      try { messages.push(JSON.parse(line) as LLMMessage); }
      catch { /* skip corrupt line — best-effort recovery, mirrors seedFromDisk */ }
    }
  } catch {
    // Unreadable file — treat as not-exists rather than throwing.
    return { messages: [], exists: false, historyDir };
  }

  return { messages, exists: true, historyDir };
}

/** Test seam — same as readDaemonSessionHistory but takes the
 *  historyDir directly, skipping the runtime.json lookup. Lets unit
 *  tests verify path traversal + jsonl parsing without booting a
 *  daemon. */
export function readDaemonSessionHistoryFromDir(
  historyDir: string,
  sessionId: string,
): DaemonHistoryReadResult {
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    sessionId.includes('/') ||
    sessionId.includes('\\') ||
    sessionId.includes('..')
  ) {
    return { messages: [], exists: false, historyDir };
  }
  const path = joinPath(historyDir, `${sessionId}.jsonl`);
  if (!existsSync(path)) {
    return { messages: [], exists: false, historyDir };
  }
  const messages: LLMMessage[] = [];
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      try { messages.push(JSON.parse(line) as LLMMessage); }
      catch { /* skip corrupt */ }
    }
  } catch {
    return { messages: [], exists: false, historyDir };
  }
  return { messages, exists: true, historyDir };
}
