// NEXUS · Telegram HITL confirm channel wire-up (β-1b · 2026-05-08).
//
// Wraps the existing `createTelegramHitlPostDeps` (src/hitl/telegram-
// channel.ts) + `createTelegramConfirmChannel` (src/hitl/confirm.ts)
// into a NEXUS-shaped lifecycle: env-gated bot creation + start/stop
// hooks the runtime can call from `runNexus()` boot + release.
//
// Why it lives here, not in `src/hitl/`: the bot-lifecycle ownership
// (poll loop start, shutdown) is NEXUS-specific. The legacy
// dashboard already owns one bot via `botFromConfig`; mirroring
// here would either fight for the same /getUpdates poller (409
// conflict) or duplicate the message-handler. The β-1b convention:
//   • Two distinct env vars:
//       ELANOUS_TELEGRAM_HITL_BOT_TOKEN — separate bot token preferred
//       ELANOUS_TELEGRAM_HITL_CHAT_ID   — target chat for HITL prompts
//   • The legacy chat bot stays untouched (its env var is
//     `userConfig.telegram.botToken`, totally unrelated).
//
// Failure modes:
//   • Env not set      → factory returns null · channel skipped silently
//   • Bot start crashes → log + channel returns null on next request()
//   • User offline     → confirm.ts onTimeout fallback (5min agent-cli
//                         default) eventually fires; sibling channels
//                         (Pushcut, PWA banner) can race independently.
//
// Tests: `test/nexus-hitl-telegram-channel.test.ts`.

import { TelegramBot } from '../../telegram.js';
import {
  createTelegramConfirmChannel,
  type ConfirmChannel,
} from '../../hitl/confirm.js';
import { createTelegramHitlPostDeps } from '../../hitl/telegram-channel.js';

export interface NexusTelegramHitlOpts {
  /** Bot API token from @BotFather. Production reads
   *  `ELANOUS_TELEGRAM_HITL_BOT_TOKEN` env when not supplied. */
  token: string;
  /** Telegram chat id (numeric) where HITL prompts post. The user
   *  taps the inline keyboard inside that chat. Production reads
   *  `ELANOUS_TELEGRAM_HITL_CHAT_ID` env when not supplied. */
  chatId: number;
  /** Optional logger. Defaults to console.warn with a `[hitl/telegram]`
   *  prefix so log scrapers can filter the channel. */
  log?: (msg: string) => void;
  /** Test seam — pre-built TelegramBot for unit tests that drive the
   *  callback handler directly without running the long-poll. When
   *  supplied, the factory skips constructing a bot from `token` and
   *  also skips calling `bot.start()` so the test stays fast. */
  bot?: TelegramBot;
  /** Test seam — fetch impl forwarded into the constructed bot. */
  fetchImpl?: typeof fetch;
}

export interface NexusTelegramHitlHandle {
  /** ConfirmChannel ready to register via
   *  `registerDefaultConfirmChannels`. */
  channel: ConfirmChannel;
  /** Stops the bot's poll loop. Safe to call multiple times. Idempotent
   *  — production code calls this from `runNexus()` cleanExit so the
   *  bot doesn't keep polling after shutdown. */
  stop: () => Promise<void>;
}

/** Reads `ELANOUS_TELEGRAM_HITL_BOT_TOKEN` + `ELANOUS_TELEGRAM_HITL_CHAT_ID`
 *  from `process.env` and returns the parsed opts, or null when either
 *  is missing/invalid. The β-1b wire honors a per-NEXUS env so the
 *  legacy dashboard chat bot (`userConfig.telegram.botToken`) stays
 *  untouched — same fleet, different token = different /getUpdates
 *  poller, no 409 conflict. */
export function readNexusTelegramHitlOptsFromEnv(env: NodeJS.ProcessEnv = process.env): NexusTelegramHitlOpts | null {
  const token = env['ELANOUS_TELEGRAM_HITL_BOT_TOKEN'];
  const chatIdRaw = env['ELANOUS_TELEGRAM_HITL_CHAT_ID'];
  if (!token || !chatIdRaw) return null;
  const chatId = Number.parseInt(chatIdRaw, 10);
  if (!Number.isFinite(chatId)) return null;
  return { token, chatId };
}

export function createNexusTelegramHitlHandle(opts: NexusTelegramHitlOpts): NexusTelegramHitlHandle | null {
  if (!opts.token) return null;
  if (!Number.isFinite(opts.chatId)) return null;

  const log = opts.log ?? ((msg: string) => { console.warn(`[hitl/telegram] ${msg}`); });

  const bot = opts.bot ?? new TelegramBot({
    token: opts.token,
    // HITL bot doesn't field user-typed messages — only inline-
    // keyboard taps (callback_query). Empty allowlist means no
    // user-message goes anywhere; onMessage is a no-op anyway.
    allowedUsers: [],
    onMessage: async () => undefined,
    log,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  const deps = createTelegramHitlPostDeps({ bot, chatId: opts.chatId });
  const channel = createTelegramConfirmChannel(deps);

  // Production starts the long-poll in the background so the bot
  // can deliver callback_query updates. We don't await — the
  // promise resolves only on stop(). Errors during the poll are
  // already logged inside TelegramBot.start (it never throws on
  // network failures, only on misconfig like 401 invalid-token).
  // Tests pre-build the bot via `opts.bot` and skip start.
  if (!opts.bot) {
    void bot.start().catch((err: unknown) => {
      log(`bot.start exited with error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return {
    channel,
    stop: async (): Promise<void> => {
      bot.stop();
    },
  };
}
