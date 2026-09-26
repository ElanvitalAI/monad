// Step 1 of platform-evolution arc — channel-agnostic ambient chunk
// buffer (hoisted from src/telegram-ambient-buffer.ts as part of
// PLAN-discord-ambient-merge.md PR a · no-op refactor).
//
// The daemon bridge installs an ambient handler on every
// `DashboardSession.attach()` so fan-out sessionUpdate notifications
// from other peers (PR #831 broadcast) reach the channel chat. Two
// design points come straight from RESEARCH-gateway-multichannel-
// telegram §2.1 (hermes Telegram):
//
//   1. Per-chat send rate limits (telegram 1msg/sec/chat, discord
//      ~50req/sec/channel) make per-chunk sendMessage a bad fit. We
//      accumulate chunks in-memory and flush once the stream goes
//      idle for `idleMs` (default 2000) — one chat message per turn.
//      Tier 1 PR 4's `DaemonSessionHistory.onAppend` hook provides
//      a turn-precise finalize signal that can flush sooner; this
//      idle-based fallback stays as a safety net for cases where
//      onAppend doesn't fire.
//
//   2. Per-sessionId state is isolated — concurrent turns on
//      different sessions don't share buffers. Map keyed by
//      sessionId mirrors hermes' `_session_tasks` ownership pattern.
//
// This module is channel-agnostic by design — telegram + discord
// (and future channels) hand in a `(sessionId, text)` callback that
// resolves sessionId → chatId via their bindings store and pushes
// via the bot's sendMessage / streamer.

export type AmbientFlushHandler = (
  sessionId: string,
  text: string,
) => void | Promise<void>;

export interface AmbientBufferOpts {
  /** Idle window before a buffered turn is flushed. Default 2000ms. */
  idleMs?: number;
  /** Optional logger for flush errors. */
  log?: (msg: string) => void;
}

interface BufferEntry {
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface AmbientBufferRegistry {
  /** Append a chunk for `sessionId`. Resets the idle timer. */
  append(sessionId: string, chunk: string): void;
  /** Force-flush a session's buffer immediately (clears the timer). */
  flush(sessionId: string): void;
  /** Force-flush every buffered session. Used on bridge close. */
  flushAll(): void;
  /** Diagnostic — sessions with pending text. */
  pendingSessions(): string[];
}

/** Build a per-sessionId chunk accumulator. The handler fires after
 *  `idleMs` of no chunk activity for a given sessionId, with the
 *  consolidated text. Handler errors are caught + logged but never
 *  propagated — observers don't break the live turn (RESEARCH §3.1). */
export function createAmbientBufferRegistry(
  onFlush: AmbientFlushHandler,
  opts: AmbientBufferOpts = {},
): AmbientBufferRegistry {
  const idleMs = opts.idleMs ?? 2000;
  const log = opts.log ?? (() => { /* silent */ });
  const buffers = new Map<string, BufferEntry>();

  function clearTimer(buf: BufferEntry): void {
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
  }

  function flush(sessionId: string): void {
    const buf = buffers.get(sessionId);
    if (!buf) return;
    clearTimer(buf);
    const text = buf.text;
    buffers.delete(sessionId);
    if (text.length === 0) return;
    try {
      const r = onFlush(sessionId, text);
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch((e) => { log(`ambient flush error: ${String(e)}`); });
      }
    } catch (e) {
      log(`ambient flush threw: ${String(e)}`);
    }
  }

  return {
    append(sessionId, chunk) {
      if (chunk.length === 0) return;
      let buf = buffers.get(sessionId);
      if (!buf) {
        buf = { text: '', timer: null };
        buffers.set(sessionId, buf);
      }
      buf.text += chunk;
      clearTimer(buf);
      buf.timer = setTimeout(() => { flush(sessionId); }, idleMs);
      // unref so a pending timer doesn't keep the event loop alive
      // when the bridge tears down.
      (buf.timer as unknown as { unref?: () => void }).unref?.();
    },
    flush,
    flushAll() {
      for (const sid of [...buffers.keys()]) flush(sid);
    },
    pendingSessions() {
      return [...buffers.keys()].filter((sid) => (buffers.get(sid)?.text.length ?? 0) > 0);
    },
  };
}

/** Extract `agent_message_chunk` text from a sessionUpdate
 *  notification shape. Returns null when the update is a different
 *  kind (tool_call, tool_call_update, agent_thought_chunk, …) or has
 *  empty text. Exported for unit testing — the bridge calls this
 *  inside its ambient handler. */
export function extractAgentMessageChunkText(notification: unknown): string | null {
  if (!notification || typeof notification !== 'object') return null;
  const inner = (notification as {
    update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } | null;
  }).update;
  if (!inner || inner.sessionUpdate !== 'agent_message_chunk') return null;
  if (inner.content?.type !== 'text') return null;
  const text = inner.content.text ?? '';
  return text.length > 0 ? text : null;
}

/** Tier 1 Phase 3 — sibling extractor for the elanous-extension
 *  `user_message_chunk` notification. Peers receive this when ANOTHER
 *  surface (PWA / TUI / different chat) sent a user prompt to the
 *  same sessionId. Returns null for non-matching shapes so the
 *  caller's switch can fall through cleanly. */
export function extractUserMessageChunkText(notification: unknown): string | null {
  if (!notification || typeof notification !== 'object') return null;
  const inner = (notification as {
    update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } | null;
  }).update;
  if (!inner || inner.sessionUpdate !== 'user_message_chunk') return null;
  if (inner.content?.type !== 'text') return null;
  const text = inner.content.text ?? '';
  return text.length > 0 ? text : null;
}
