// HITL Telegram channel — T2-P6.
//
// Wires a TelegramBot's inline-keyboard + callback_query plumbing
// into the requestConfirmation ConfirmChannel contract. The bot
// must already be running (i.e. its poll loop is active) so
// callback_query updates actually arrive.
//
// Flow:
//
//   1. post(req) — sendInlineKeyboard with two buttons whose
//      callback_data encodes the requestId + {yes,no} decision.
//   2. handler — the bot's onCallbackQuery fires when the user
//      taps. If the data matches a pending request, resolve its
//      promise with the decision + answer the callback so the
//      client-side spinner clears.
//   3. cancel — edit the original message into "cancelled" and
//      resolve with null so the race falls through to another
//      channel's answer.
//
// callback_data layout:
//   monad-hitl:<requestId>:yes|no
//
// Telegram caps callback_data at 64 bytes so requestIds should
// stay under ~50 chars. The HITL callback server mints
// `hitl-<timestamp>` ids which fit comfortably.

import type { TelegramBot, TgCallbackQuery } from '../telegram.js';
import type {
  ConfirmRequest,
  HitlAnswer,
  TelegramConfirmDeps,
} from './confirm.js';

const CALLBACK_PREFIX = 'monad-hitl';

interface Pending {
  requestId: string;
  messageId?: number;
  resolve: (answer: HitlAnswer | null) => void;
  cancel: () => Promise<void> | void;
}

export interface CreateTelegramHitlChannelOpts {
  bot: TelegramBot;
  chatId: number;
  /** Edit posted messages with outcome text after resolution.
   *  Default true — keeps the history human-readable. */
  editOnResolve?: boolean;
  /** β-1 dismiss polish (2026-05-08) — text shown when a sibling
   *  channel won the race. Default `'✗ cancelled by other device'`.
   *  Set to empty string to skip the edit + only clear the buttons.
   *  Set to null to also skip the button-clear (legacy behavior). */
  cancelText?: string | null;
}

export function createTelegramHitlPostDeps(opts: CreateTelegramHitlChannelOpts): TelegramConfirmDeps {
  const pending = new Map<string, Pending>();

  // Subscribe once — handlers are shared across every confirm request
  // in this session. Unsubscribe is tied to the lifetime of the HITL
  // wiring (until dashboard shutdown).
  opts.bot.onCallbackQuery(async (q: TgCallbackQuery) => {
    if (!q.data.startsWith(`${CALLBACK_PREFIX}:`)) return;
    const parts = q.data.split(':');
    if (parts.length < 3) return;
    const requestId = parts[1]!;
    const decision = parts[2];
    const yes = decision === 'yes';
    const entry = pending.get(requestId);
    if (!entry) {
      await opts.bot.answerCallbackQuery(q.id, { text: 'request expired' });
      return;
    }
    pending.delete(requestId);
    await opts.bot.answerCallbackQuery(q.id, {
      text: yes ? 'confirmed ✓' : 'declined ✗',
    });
    entry.resolve(yes);
  });

  return {
    async post(req: ConfirmRequest): Promise<{
      answer: Promise<HitlAnswer | null>;
      cancel(): Promise<void> | void;
    }> {
      const requestId = req.requestId ?? `hitl-${Date.now().toString(36)}`;
      const text = [
        req.prompt,
        req.detail ? `\n${req.detail}` : '',
      ].filter(Boolean).join('');
      const posted = await opts.bot.sendInlineKeyboard(
        opts.chatId,
        text,
        [[
          { text: req.yesLabel ?? 'Yes', data: `${CALLBACK_PREFIX}:${requestId}:yes` },
          { text: req.noLabel  ?? 'No',  data: `${CALLBACK_PREFIX}:${requestId}:no` },
        ]],
      );

      let resolver: (a: HitlAnswer | null) => void;
      const answer = new Promise<HitlAnswer | null>((resolve) => { resolver = resolve; });
      const cancel = async (): Promise<void> => {
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId);
        // β-1 dismiss polish (2026-05-08) — best-effort visual
        // dismiss when a sibling channel won the race. Both calls
        // tolerate "message not found" / "not modified" silently
        // via the throttledCall ignore hook.
        const cancelText = opts.cancelText === undefined
          ? '✗ cancelled by other device'
          : opts.cancelText;
        if (entry.messageId !== undefined) {
          if (cancelText !== null && cancelText !== '') {
            try { await opts.bot.editMessageText(opts.chatId, entry.messageId, cancelText); }
            catch { /* swallow */ }
          }
          if (cancelText !== null) {
            try { await opts.bot.clearMessageReplyMarkup(opts.chatId, entry.messageId); }
            catch { /* swallow */ }
          }
        }
        entry.resolve(null);
      };
      pending.set(requestId, {
        requestId,
        messageId: posted?.messageId,
        resolve: resolver!,
        cancel,
      });

      return { answer, cancel };
    },
  };
}
