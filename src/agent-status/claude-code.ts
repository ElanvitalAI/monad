// ── claude-code JSONL parser (US2) ──
//
// Parses line-delimited JSON events emitted by `claude --stream-json`
// and maps them to the 4-state machine (idle/working/awaiting/done/err).
//
// Events handled (allowlist — unknowns are logged via the optional
// `onUnknown` hook but never crash the parser):
//   message_start            → working
//   content_block_start      → working
//   content_block_delta      → working (coalesced — already working)
//   message_delta            → working
//   tool_use / tool_use_*    → awaiting (pending approval gate)
//   tool_result              → working (approval resolved, back to thinking)
//   message_stop / result    → done
//   error                    → err
//
// Non-JSON lines are treated as heuristic fallback: a trailing
// `> ` prompt restores idle so the sidebar badge doesn't stay
// stuck at `working` after claude exits gracefully without a
// final `result` event.
//
// The parser is a streaming state machine — feed(id, chunk) can
// be called with partial lines, and the incomplete tail buffers
// until the next newline arrives.

import type { AgentStatusStore } from './store.js';
import type { SessionStatus } from '../session/card.js';
import type { BlockStore } from '../block/store.js';

const PROMPT_RE = /(^|\n)>\s*$/;

/** BL2 — per-block text budget. claude can emit massive content_block_delta
 *  streams (code review, refactors). Capping at 4 KB keeps attached
 *  blocks under the LLM context budget without silently dropping. */
export const TEXT_CAP_CHARS = 4096;

interface PendingBlock {
  startedAt: number;
  text: string;
  events: string[];
  truncated: boolean;
}

interface BufferState {
  tail: string;
  lastStatus: SessionStatus;
  /** BL2 — block assembled across events. Begin on message_start,
   *  commit on message_stop/result/error. */
  pending: PendingBlock | null;
}

export interface ClaudeCodeParserDeps {
  readonly store: AgentStatusStore;
  readonly onUnknown?: (id: string, rawLine: string, reason: string) => void;
  /** BL2 — optional BlockStore. When present, message_start begins a
   *  pending block, content_block_delta / message_delta concat their
   *  text payloads, and message_stop/result commits. error also
   *  commits but stamps `meta.error`. */
  readonly blockStore?: BlockStore;
}

function extractDeltaText(ev: Record<string, unknown>): string {
  const delta = ev['delta'];
  if (delta && typeof delta === 'object') {
    const d = delta as Record<string, unknown>;
    if (typeof d['text'] === 'string') return d['text'] as string;
    if (typeof d['partial_json'] === 'string') return d['partial_json'] as string;
  }
  if (typeof ev['text'] === 'string') return ev['text'] as string;
  return '';
}

function appendCapped(pending: PendingBlock, addition: string): void {
  if (pending.truncated) return;
  const remaining = TEXT_CAP_CHARS - pending.text.length;
  if (remaining <= 0) {
    pending.truncated = true;
    return;
  }
  if (addition.length > remaining) {
    pending.text += addition.slice(0, remaining);
    pending.truncated = true;
  } else {
    pending.text += addition;
  }
}

export function createClaudeCodeParser(deps: ClaudeCodeParserDeps) {
  const buffers = new Map<string, BufferState>();

  const beginBlock = (buf: BufferState, ev: string): void => {
    if (!deps.blockStore) return;
    buf.pending = {
      startedAt: deps.blockStore.clock(),
      text: '',
      events: [ev],
      truncated: false,
    };
  };

  const extendBlock = (buf: BufferState, ev: string, text: string): void => {
    if (!deps.blockStore) return;
    if (!buf.pending) {
      // implicit begin — claude sometimes streams delta before an
      // explicit start (multi-turn conversation resumption).
      beginBlock(buf, ev);
    }
    buf.pending!.events.push(ev);
    if (text) appendCapped(buf.pending!, text);
  };

  const commitBlock = (id: string, buf: BufferState, ev: string, meta?: Record<string, unknown>): void => {
    if (!deps.blockStore || !buf.pending) return;
    const p = buf.pending;
    buf.pending = null;
    deps.blockStore.push(id, {
      kind: 'claude-code',
      startedAt: p.startedAt,
      endedAt: deps.blockStore.clock(),
      text: p.truncated ? `${p.text}\n... [truncated at ${TEXT_CAP_CHARS} chars]` : p.text,
      events: [...p.events, ev],
      ...(meta ? { meta } : {}),
    });
  };

  const classify = (ev: Record<string, unknown>): { status: SessionStatus; tag: string } | null => {
    const type = typeof ev['type'] === 'string' ? ev['type'] as string : '';
    if (!type) return null;
    if (type === 'message_start' || type === 'content_block_start' || type === 'content_block_delta' || type === 'message_delta') {
      return { status: 'working', tag: type };
    }
    if (type.startsWith('tool_use')) {
      return { status: 'awaiting', tag: type };
    }
    if (type === 'tool_result') {
      return { status: 'working', tag: 'tool_result' };
    }
    if (type === 'message_stop' || type === 'result') {
      return { status: 'done', tag: type };
    }
    if (type === 'error') {
      return { status: 'err', tag: 'error' };
    }
    return null;
  };

  const applyLine = (id: string, line: string, buf: BufferState): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    // JSONL fast path
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const ev = JSON.parse(trimmed) as Record<string, unknown>;
        const type = typeof ev['type'] === 'string' ? ev['type'] as string : '';
        const classified = classify(ev);
        if (classified) {
          deps.store.set(id, classified.status, classified.tag);
          buf.lastStatus = classified.status;
        } else {
          deps.onUnknown?.(id, trimmed, 'unhandled-type');
        }
        // BL2 — block assembly happens _in addition to_ status
        // classification. Both layers are independent.
        if (type === 'message_start') {
          beginBlock(buf, type);
        } else if (type === 'content_block_delta' || type === 'message_delta' || type === 'content_block_start') {
          extendBlock(buf, type, extractDeltaText(ev));
        } else if (type === 'message_stop' || type === 'result') {
          commitBlock(id, buf, type);
        } else if (type === 'error') {
          commitBlock(id, buf, type, { error: ev['error'] ?? ev['message'] ?? true });
        }
        return;
      } catch {
        deps.onUnknown?.(id, trimmed, 'parse-error');
        return;
      }
    }
    // Heuristic fallback — a lone `> ` prompt means claude exited
    // to the REPL. Only flip to idle if we were previously in a
    // non-terminal state; done/err stays sticky until the next
    // working transition.
    if (PROMPT_RE.test(line)) {
      if (buf.lastStatus === 'working' || buf.lastStatus === 'awaiting') {
        deps.store.set(id, 'idle', 'prompt-detect');
        buf.lastStatus = 'idle';
        // Commit any pending block so attach can pick it up — REPL
        // prompt is a soft block boundary when the JSONL stream
        // never fired a formal stop.
        if (buf.pending) commitBlock(id, buf, 'prompt-detect');
      }
    }
  };

  return {
    feed(id: string, chunk: string): void {
      let buf = buffers.get(id);
      if (!buf) {
        buf = {
          tail: '',
          lastStatus: deps.store.get(id) ?? 'idle',
          pending: null,
        };
        buffers.set(id, buf);
      }
      const combined = buf.tail + chunk;
      const parts = combined.split('\n');
      buf.tail = parts.pop() ?? '';
      for (const line of parts) applyLine(id, line, buf);
      // If the tail itself is the `> ` prompt (no trailing newline),
      // still fire the idle transition. Prevents "working forever"
      // when the REPL line ends without a CR.
      if (PROMPT_RE.test(buf.tail)) {
        applyLine(id, buf.tail, buf);
        buf.tail = '';
      }
    },

    /** Drop buffered tail for a session — call on process exit so a
     *  future spawn doesn't inherit stale data. */
    reset(id: string): void {
      buffers.delete(id);
    },
  };
}
