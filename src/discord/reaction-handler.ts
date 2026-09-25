// Discord reaction handler — HITL approval/reject gate.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.4)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// auto-relay (Showroom v2 Arc 4) 의 HITL approval 을 Discord reaction
// (👍/👎) 으로 자연스럽게. 사용자가 모바일에서 한 탭으로 dispatch
// 승인/거부 가능 — typing indicator + 메시지 답글 기반보다 1-tap
// UX 가 훨씬 빠름.
//
// Pure helper + in-memory registry — gateway integration (intent
// 확장 + MESSAGE_REACTION_ADD/REMOVE event routing) 은 caller 책임
// (src/discord.ts 의 dispatch 에서 handleReaction() 호출).

import { debug } from '../debug/log.js';

/** Discord-shaped emoji (subset). Native unicode emoji 는 `id`
 *  null + `name` 이 unicode 그대로. Custom server emoji 는 `id` 가
 *  Discord snowflake. */
export interface ReactionEmoji {
  /** Unicode glyph or custom emoji name. */
  readonly name: string;
  /** Custom emoji snowflake id, undefined for unicode. */
  readonly id?: string;
  readonly animated?: boolean;
}

/** Inbound reaction event (normalized from gateway dispatch). */
export interface ReactionEvent {
  readonly channelId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: ReactionEmoji;
  /** True for MESSAGE_REACTION_REMOVE, false/undefined for ADD. */
  readonly removed?: boolean;
  readonly ts?: number;
  /** Guild id (DMs omit). Optional — handler doesn't gate on this. */
  readonly guildId?: string;
}

export type ApprovalDecision = 'approve' | 'reject' | 'unknown';

/** Default approve / reject emoji sets. Caller can override per-gate
 *  via `ApprovalGate` constructor. */
export const DEFAULT_APPROVE_EMOJI: ReadonlySet<string> = new Set([
  '👍', '👌', '✅', '✔️', '✔', '🆗',
]);
export const DEFAULT_REJECT_EMOJI: ReadonlySet<string> = new Set([
  '👎', '❌', '✖️', '✖', '🛑', '🚫',
]);

/** Map a single emoji to an approval decision using a (approve, reject)
 *  vocab pair. Custom emoji (`emoji.id !== undefined`) only match by
 *  exact name in the vocab — typically not used for HITL. */
export function emojiToDecision(
  emoji: ReactionEmoji,
  approveSet: ReadonlySet<string> = DEFAULT_APPROVE_EMOJI,
  rejectSet: ReadonlySet<string> = DEFAULT_REJECT_EMOJI,
): ApprovalDecision {
  const name = emoji.name;
  if (approveSet.has(name)) return 'approve';
  if (rejectSet.has(name)) return 'reject';
  return 'unknown';
}

/** Event fired to a watcher when a tracked message receives a
 *  meaningful reaction. */
export interface ApprovalEvent {
  readonly messageId: string;
  readonly decision: ApprovalDecision;
  readonly userId: string;
  readonly emoji: ReactionEmoji;
  readonly removed: boolean;
  readonly ts: number;
}

export type ApprovalListener = (event: ApprovalEvent) => void;

interface WatchOpts {
  /** When true, the listener is auto-unregistered after the first
   *  decision !== 'unknown'. Default: true (one-shot HITL gate). */
  readonly oneShot?: boolean;
  /** Restrict who can decide. Empty/undefined = anyone in the channel. */
  readonly allowedUserIds?: ReadonlySet<string>;
  /** Override per-gate approve/reject vocab. */
  readonly approveSet?: ReadonlySet<string>;
  readonly rejectSet?: ReadonlySet<string>;
}

interface WatchEntry {
  readonly listener: ApprovalListener;
  readonly opts: WatchOpts;
}

/** Tracks (messageId → listener) so the gateway dispatch can route
 *  reaction events to whoever is waiting on that message's HITL
 *  decision. */
export class ApprovalGate {
  private readonly byMessage = new Map<string, WatchEntry[]>();

  /** Register a listener for reactions on `messageId`. Returns an
   *  unsubscribe function. */
  watch(
    messageId: string,
    listener: ApprovalListener,
    opts: WatchOpts = {},
  ): () => void {
    const list = this.byMessage.get(messageId) ?? [];
    const entry: WatchEntry = {
      listener,
      opts: { oneShot: opts.oneShot ?? true, ...opts },
    };
    list.push(entry);
    this.byMessage.set(messageId, list);
    if (debug.enabled) {
      debug.log('discord.reaction.watch', `messageId=${messageId}`, {
        oneShot: entry.opts.oneShot, listeners: list.length,
      });
    }
    return () => this.unsubscribe(messageId, entry);
  }

  /** Total active watchers across all messages — for status / debug. */
  size(): number {
    let n = 0;
    for (const list of this.byMessage.values()) n += list.length;
    return n;
  }

  /** Whether there's at least one watcher for `messageId`. */
  has(messageId: string): boolean {
    return (this.byMessage.get(messageId)?.length ?? 0) > 0;
  }

  /** Drop all watchers for a messageId (e.g., dispatch superseded). */
  cancel(messageId: string): number {
    const n = this.byMessage.get(messageId)?.length ?? 0;
    this.byMessage.delete(messageId);
    return n;
  }

  /** Clear all watchers (test cleanup). */
  reset(): void {
    this.byMessage.clear();
  }

  /** Feed a normalized reaction event in. Routes to all matching
   *  watchers, applies oneShot pruning, and returns the count of
   *  listeners notified. */
  handleReaction(event: ReactionEvent): number {
    const list = this.byMessage.get(event.messageId);
    if (!list || list.length === 0) return 0;

    const ts = event.ts ?? Date.now();
    const removed = event.removed === true;
    let notified = 0;
    const survivors: WatchEntry[] = [];

    for (const entry of list) {
      const { listener, opts } = entry;

      if (opts.allowedUserIds && opts.allowedUserIds.size > 0
          && !opts.allowedUserIds.has(event.userId)) {
        survivors.push(entry);
        continue;
      }
      const decision = emojiToDecision(event.emoji, opts.approveSet, opts.rejectSet);
      if (decision === 'unknown') {
        survivors.push(entry);
        continue;
      }

      try {
        listener({
          messageId: event.messageId,
          decision, userId: event.userId, emoji: event.emoji,
          removed, ts,
        });
      } catch (err: unknown) {
        if (debug.enabled) {
          debug.log('discord.reaction.listener.error', `messageId=${event.messageId}`, {
            error: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
      notified++;

      // oneShot is satisfied only on ADD (not on REMOVE) — prevents
      // remove-event from prematurely tearing down the gate.
      if (opts.oneShot && !removed) {
        // drop this entry (do not push to survivors)
      } else {
        survivors.push(entry);
      }
    }

    if (survivors.length === 0) {
      this.byMessage.delete(event.messageId);
    } else {
      this.byMessage.set(event.messageId, survivors);
    }

    if (debug.enabled) {
      debug.log('discord.reaction.dispatch', `messageId=${event.messageId}`, {
        notified, remaining: survivors.length, removed,
      });
    }
    return notified;
  }

  // ── private ──────────────────────────────────────────────────

  private unsubscribe(messageId: string, target: WatchEntry): void {
    const list = this.byMessage.get(messageId);
    if (!list) return;
    const idx = list.indexOf(target);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (list.length === 0) this.byMessage.delete(messageId);
    else this.byMessage.set(messageId, list);
  }
}
