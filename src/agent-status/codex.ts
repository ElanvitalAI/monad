// ── codex heuristic parser (US3 + BL3) ──
//
// codex-cli does not emit structured JSONL by default; we fall back
// to substring scans against its typical status banners. Matching
// is conservative — only the first hit on each fed chunk fires a
// transition so a single stdout frame doesn't bounce the badge.
//
// Patterns (first-match wins):
//   "Error" / "error:"          → err
//   "Thinking"                  → working
//   "Running" / "Executing"     → working
//   "Awaiting approval" / "Y/N" → awaiting
//   "Done" / "Finished"         → done
//
// Trailing prompt `> ` restores idle like the claude parser's
// heuristic fallback.
//
// BL3 — block builder. Unlike claude's explicit boundaries, codex's
// boundaries are inferred:
//   - "Thinking..." / "Running" → begin (unless already pending)
//   - "Done" / "Finished"       → commit
//   - "Error"                   → commit + meta.error
//   - prompt `> ` on transition → commit (soft boundary)
//
// The chunk that triggers a *begin* transition also opens the block's
// text buffer and starts appending subsequent chunks verbatim
// (stripped of ANSI + trimmed). On commit, the buffer becomes the
// block's text.

import type { AgentStatusStore } from './store.js';
import type { SessionStatus } from '../session/card.js';
import type { BlockStore } from '../block/store.js';

export const CODEX_TEXT_CAP_CHARS = 4096;

interface Rule {
  re: RegExp;
  status: SessionStatus;
  tag: string;
}

const RULES: readonly Rule[] = [
  { re: /\b[Ee]rror\b[: ]/,       status: 'err',      tag: 'codex-error' },
  { re: /\bAwaiting\b|\bY\/N\b/,   status: 'awaiting', tag: 'codex-awaiting' },
  { re: /\bThinking\b/,            status: 'working',  tag: 'codex-thinking' },
  { re: /\bRunning\b|\bExecuting\b/, status: 'working',  tag: 'codex-running' },
  { re: /\bDone\b|\bFinished\b/,   status: 'done',     tag: 'codex-done' },
];

const PROMPT_RE = /(^|\n)>\s*$/;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

interface PendingBlock {
  startedAt: number;
  text: string;
  events: string[];
  truncated: boolean;
}

interface BufferState {
  pending: PendingBlock | null;
}

export interface CodexParserDeps {
  readonly store: AgentStatusStore;
  readonly blockStore?: BlockStore;
}

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function appendCapped(pending: PendingBlock, addition: string): void {
  if (pending.truncated) return;
  const remaining = CODEX_TEXT_CAP_CHARS - pending.text.length;
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

export function createCodexParser(deps: CodexParserDeps) {
  const buffers = new Map<string, BufferState>();

  const bufFor = (id: string): BufferState => {
    let b = buffers.get(id);
    if (!b) {
      b = { pending: null };
      buffers.set(id, b);
    }
    return b;
  };

  const beginBlock = (buf: BufferState, tag: string): void => {
    if (!deps.blockStore) return;
    if (buf.pending) return; // already in-flight — don't reset
    buf.pending = {
      startedAt: deps.blockStore.clock(),
      text: '',
      events: [tag],
      truncated: false,
    };
  };

  const commitBlock = (id: string, buf: BufferState, tag: string, meta?: Record<string, unknown>): void => {
    if (!deps.blockStore || !buf.pending) return;
    const p = buf.pending;
    buf.pending = null;
    deps.blockStore.push(id, {
      kind: 'codex',
      startedAt: p.startedAt,
      endedAt: deps.blockStore.clock(),
      text: p.truncated ? `${p.text}\n... [truncated at ${CODEX_TEXT_CAP_CHARS} chars]` : p.text,
      events: [...p.events, tag],
      ...(meta ? { meta } : {}),
    });
  };

  return {
    feed(id: string, chunk: string): void {
      if (!chunk) return;
      const buf = bufFor(id);
      const cleaned = stripAnsi(chunk);

      // Text accumulation — every chunk while a block is pending is
      // buffered, capped. Happens irrespective of status match.
      if (buf.pending) appendCapped(buf.pending, cleaned);

      for (const rule of RULES) {
        if (rule.re.test(chunk)) {
          deps.store.set(id, rule.status, rule.tag);
          if (rule.status === 'working') {
            beginBlock(buf, rule.tag);
            // If the begin itself brought text with it, include it
            // in the block.
            if (deps.blockStore && buf.pending && buf.pending.events.length === 1 && buf.pending.text.length === 0) {
              appendCapped(buf.pending, cleaned);
            }
          } else if (rule.status === 'done') {
            commitBlock(id, buf, rule.tag);
          } else if (rule.status === 'err') {
            commitBlock(id, buf, rule.tag, { error: true });
          }
          return;
        }
      }

      if (PROMPT_RE.test(chunk)) {
        const prev = deps.store.get(id);
        if (prev === 'working' || prev === 'awaiting') {
          deps.store.set(id, 'idle', 'codex-prompt-detect');
          commitBlock(id, buf, 'codex-prompt-detect');
        }
      }
    },

    reset(id: string): void {
      buffers.delete(id);
    },
  };
}
