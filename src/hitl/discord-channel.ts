// AXON P4 — HITL Discord channel deps.
//
// Mirror of src/hitl/telegram-channel.ts (canonical pattern). The
// Telegram channel uses callback_query data with the `monad-hitl:`
// prefix; Discord uses button component customIds with the same
// shape. Both channels post a message that embeds Yes / No buttons,
// then wait for the user to tap one before resolving the pending
// promise.
//
// Intentionally `DiscordBot` is declared as a narrow interface below
// rather than imported from a concrete Discord SDK module — this
// keeps the core HITL layer SDK-agnostic and lets tests inject a
// fake. The real dashboard wiring passes in a thin adapter over
// `src/discord.ts` (which already exists for outbound messages).
//
// Wire format:
//   customId = monad-hitl-disc:<requestId>:<yes|no>
//
// Discord caps customId at 100 bytes, well above the 64-byte
// Telegram limit. Our hitl-<timestamp> request ids sit under 20
// chars, so either channel is safe.

import type {
  ConfirmRequest,
  DiscordConfirmDeps,
  HitlAnswer,
} from './confirm.js';

const CUSTOM_ID_PREFIX = 'monad-hitl-disc';

/** Narrow view of the Discord client/bot monad already uses elsewhere.
 *  We only need the bits to post a message with buttons and subscribe
 *  to button taps — the rest (presence, voice, etc.) is not our
 *  concern. Real impls wrap discord.js; tests inject a fake. */
export interface DiscordBot {
  /** Post a message with a single row of two buttons. Returns an
   *  identifier the caller can use to edit / delete the message
   *  later (typically the Discord message id as a string). */
  sendButtons(
    channelId: string,
    text: string,
    buttons: ReadonlyArray<{ label: string; customId: string; style?: 'primary' | 'secondary' | 'danger' }>,
  ): Promise<{ messageId: string } | undefined>;

  /** Subscribe to button-tap events. Handler receives the customId
   *  that was clicked plus a function to acknowledge the interaction
   *  (so Discord clears the user's spinner). */
  onButtonClick(handler: (q: DiscordButtonQuery) => void | Promise<void>): void;

  /** Optional — edit a previously-posted message to show the outcome.
   *  No-op when the bot impl chooses not to support it; the resolver
   *  fires regardless. */
  editMessage?(channelId: string, messageId: string, text: string): Promise<void>;
}

export interface DiscordButtonQuery {
  customId: string;
  /** Stable channel identifier the click came from. */
  channelId: string;
  /** User-facing ack — show a tiny ephemeral response ("confirmed ✓").
   *  Calling this once per query is idempotent enough for our needs. */
  ack(text?: string): Promise<void>;
}

export interface CreateDiscordHitlChannelOpts {
  bot: DiscordBot;
  /** Where to post prompts. Must be a channel the bot has post-rights
   *  in. Monad config typically pins this at startup. */
  channelId: string;
  /** Edit posted messages with outcome text after resolution.
   *  Default true — keeps the history human-readable. */
  editOnResolve?: boolean;
}

interface Pending {
  requestId: string;
  messageId?: string;
  resolve: (answer: HitlAnswer | null) => void;
}

export function createDiscordHitlPostDeps(
  opts: CreateDiscordHitlChannelOpts,
): DiscordConfirmDeps {
  const pending = new Map<string, Pending>();

  // Subscribe once per channel instance — handlers are shared across
  // every confirm request. Matches the Telegram channel's lifetime
  // model (dashboard lifetime).
  opts.bot.onButtonClick(async (q) => {
    if (!q.customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) return;
    if (q.channelId !== opts.channelId) return;
    const parts = q.customId.split(':');
    if (parts.length < 3) return;
    const requestId = parts[1]!;
    const decision = parts[2];
    const yes = decision === 'yes';
    const entry = pending.get(requestId);
    if (!entry) {
      await q.ack('request expired');
      return;
    }
    pending.delete(requestId);
    await q.ack(yes ? 'confirmed ✓' : 'declined ✗');
    if (opts.editOnResolve !== false && entry.messageId && opts.bot.editMessage) {
      const outcome = yes ? '✓ confirmed' : '✗ declined';
      try { await opts.bot.editMessage(opts.channelId, entry.messageId, outcome); }
      catch { /* best-effort — answer already resolved */ }
    }
    entry.resolve(yes);
  });

  return {
    async post(req: ConfirmRequest) {
      const requestId = req.requestId ?? `hitl-${Date.now().toString(36)}`;
      const text = [
        req.prompt,
        req.detail ? `\n${req.detail}` : '',
      ].filter(Boolean).join('');
      const posted = await opts.bot.sendButtons(
        opts.channelId,
        text,
        [
          { label: req.yesLabel ?? 'Yes', customId: `${CUSTOM_ID_PREFIX}:${requestId}:yes`, style: 'primary' },
          { label: req.noLabel  ?? 'No',  customId: `${CUSTOM_ID_PREFIX}:${requestId}:no`,  style: 'secondary' },
        ],
      );

      let resolver!: (a: HitlAnswer | null) => void;
      const answer = new Promise<HitlAnswer | null>((resolve) => { resolver = resolve; });
      const entry: Pending = {
        requestId,
        resolve: resolver,
      };
      if (posted?.messageId !== undefined) entry.messageId = posted.messageId;
      pending.set(requestId, entry);

      const cancel = async (): Promise<void> => {
        const current = pending.get(requestId);
        if (!current) return;
        pending.delete(requestId);
        if (opts.editOnResolve !== false && current.messageId && opts.bot.editMessage) {
          try { await opts.bot.editMessage(opts.channelId, current.messageId, '— cancelled —'); }
          catch { /* best-effort */ }
        }
        current.resolve(null);
      };

      return { answer, cancel };
    },
  };
}
