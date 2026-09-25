// ── BlockAttach (BL4 + BL5 + BL-E1 multi-attach) ──
//
// Pending block attachments between `[Attach]` toolbelt clicks and
// the next chat message submit. Session N landed as single-slot (a
// newer attach overwrote the older). Session O (BL-E1) upgrades to
// a list so the user can queue several sessions' blocks into one
// prompt — Warp's multi-block-as-context equivalent.
//
// Semantics:
//   attach(sid, store)          append (bounded by capAttachments)
//   list() / getPending()       snapshot (newest last)
//   clear() / clearSession(sid) drop all / drop matching
//   prependTo(msg)              stack block prefixes in order
//   consume(msg)                prependTo + clear (one-shot)
//   banner()                    summary string or null
//
// Kept in its own module so the logic is unit-testable without the
// full dashboard harness.

import type { Block, BlockStore } from './store.js';

export interface PendingAttachment {
  readonly sessionId: string;
  readonly block: Block;
}

export type AttachResult =
  | { kind: 'attached'; attachment: PendingAttachment; lines: number; bytes: number; total: number }
  | { kind: 'no-block' };

export interface BlockAttachOpts {
  /** Max queued attachments before oldest is dropped. Default 5. */
  capAttachments?: number;
}

const DEFAULT_CAP = 5;

export class BlockAttachState {
  private pending: PendingAttachment[] = [];
  private readonly cap: number;

  constructor(opts: BlockAttachOpts = {}) {
    this.cap = opts.capAttachments ?? DEFAULT_CAP;
  }

  /** BL4 / BL-E1 — append the session's latest block to the queue.
   *  When the queue is already at cap, oldest is dropped. Returns the
   *  outcome so the caller can format the right toast / chat-line. */
  attach(sessionId: string, store: BlockStore): AttachResult {
    const block = store.getLatest(sessionId);
    if (!block) return { kind: 'no-block' };
    const attachment: PendingAttachment = { sessionId, block };
    this.pending.push(attachment);
    while (this.pending.length > this.cap) this.pending.shift();
    return {
      kind: 'attached',
      attachment,
      lines: block.text.split('\n').length,
      bytes: block.text.length,
      total: this.pending.length,
    };
  }

  /** Backward-compatible convenience — returns the newest pending
   *  attachment (or null). Callers that need the full queue should
   *  use `list()`. */
  getPending(): PendingAttachment | null {
    return this.pending.length > 0 ? this.pending[this.pending.length - 1]! : null;
  }

  list(): readonly PendingAttachment[] {
    return this.pending.slice();
  }

  count(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
  }

  /** Drop every attachment whose sessionId matches. Returns the
   *  number removed. Useful for a per-session detach slash. */
  clearSession(sessionId: string): number {
    const before = this.pending.length;
    this.pending = this.pending.filter(a => a.sessionId !== sessionId);
    return before - this.pending.length;
  }

  /** BL5 / BL-E1 — wrap a user message with each attached block as
   *  context prefix, stacked oldest-first. Returns the unchanged
   *  message when nothing is pending. Does NOT clear. */
  prependTo(userMessage: string): string {
    if (this.pending.length === 0) return userMessage;
    const parts: string[] = [];
    for (const { block, sessionId } of this.pending) {
      parts.push(`[Attached block ${block.id} from ${sessionId} (${block.kind})]\n${block.text}`);
    }
    return `${parts.join('\n\n---\n\n')}\n\n---\n\n${userMessage}`;
  }

  /** BL5 — consume = prependTo + clear. Convenience for the chat
   *  submit path that always wants one-shot attach semantics. */
  consume(userMessage: string): string {
    const out = this.prependTo(userMessage);
    this.clear();
    return out;
  }

  /** BL5 / BL-E1 — banner line shown above the chat input while
   *  attachments are queued. Returns null when nothing is pending. */
  banner(): string | null {
    if (this.pending.length === 0) return null;
    if (this.pending.length === 1) {
      const { block, sessionId } = this.pending[0]!;
      const lines = block.text.split('\n').length;
      const kb = (block.text.length / 1024).toFixed(1);
      return `📎 attached ${block.id} from ${sessionId} · ${lines}L · ${kb}KB · Esc to detach`;
    }
    let totalLines = 0;
    let totalBytes = 0;
    const sids = new Set<string>();
    for (const { block, sessionId } of this.pending) {
      totalLines += block.text.split('\n').length;
      totalBytes += block.text.length;
      sids.add(sessionId);
    }
    const kb = (totalBytes / 1024).toFixed(1);
    return `📎 ${this.pending.length} blocks attached from ${sids.size} sessions · ${totalLines}L · ${kb}KB · /attach-clear to detach`;
  }
}
