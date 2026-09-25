// NEXUS · Discord HITL confirm channel wire-up (β-1c · 2026-05-08).
//
// Mirror of `hitl-telegram-channel.ts`. The Discord channel uses
// button components + INTERACTION_CREATE for the user's tap, in
// contrast to Telegram's inline_keyboard + callback_query. Both
// resolve through the same `runtimeHitlPending` Map → single
// `/v1/hitl/callback/:id` POST endpoint.
//
// The narrow `DiscordBot` interface that `src/hitl/discord-channel.ts`
// declares isn't satisfied directly by monad's DiscordBot class —
// monad's bot speaks raw gateway+REST and exposes `onInteraction`
// (raw INTERACTION_CREATE) + `respondToInteraction` (callback POST)
// + the new `sendMessageWithComponents`. This module's
// `createDiscordBotHitlAdapter` bridges the two so the existing
// confirm-channel adapter stays unchanged.
//
// Failure modes:
//   • Env not set      → factory returns null · channel skipped silently
//   • Bot start crashes → log + channel surfaces null on next request()
//   • User offline     → confirm.ts onTimeout fallback eventually fires;
//                         sibling channels (Pushcut, PWA, Telegram) race.

import {
  DiscordBot,
  type DcMessageHandler,
} from '../../discord.js';
import {
  createDiscordConfirmChannel,
  type ConfirmChannel,
} from '../../hitl/confirm.js';
import {
  createDiscordHitlPostDeps,
  type DiscordBot as HitlDiscordBot,
  type DiscordButtonQuery,
} from '../../hitl/discord-channel.js';

export interface NexusDiscordHitlOpts {
  /** Bot token (without `Bot ` prefix). Production reads
   *  `MONAD_DISCORD_HITL_BOT_TOKEN` env when not supplied. */
  token: string;
  /** Discord channel id (snowflake string) where HITL prompts post.
   *  Production reads `MONAD_DISCORD_HITL_CHANNEL_ID` env. */
  channelId: string;
  /** Optional logger. Defaults to `[hitl/discord]` prefix. */
  log?: (msg: string) => void;
  /** Test seam — pre-built monad DiscordBot. When supplied, the
   *  factory skips constructing one from `token` and skips the
   *  start() call so unit tests can drive `onInteraction` directly. */
  bot?: DiscordBot;
  /** Test seam — fetch impl forwarded into the constructed bot. */
  fetchImpl?: typeof fetch;
  /** Test seam — WebSocket impl forwarded into the constructed bot. */
  wsImpl?: typeof WebSocket;
}

export interface NexusDiscordHitlHandle {
  channel: ConfirmChannel;
  /** Stop the bot's gateway connection. Idempotent. */
  stop: () => Promise<void>;
}

export function readNexusDiscordHitlOptsFromEnv(env: NodeJS.ProcessEnv = process.env): NexusDiscordHitlOpts | null {
  const token = env['MONAD_DISCORD_HITL_BOT_TOKEN'];
  const channelId = env['MONAD_DISCORD_HITL_CHANNEL_ID'];
  if (!token || !channelId) return null;
  return { token, channelId };
}

/** Bridge monad's DiscordBot to the narrow `DiscordBot` interface
 *  expected by `src/hitl/discord-channel.ts`. Listens to the bot's
 *  raw INTERACTION_CREATE callback, filters MESSAGE_COMPONENT
 *  interactions (component_type=2 = button), and dispatches each
 *  custom_id to subscribers via `onButtonClick`. */
export function createDiscordBotHitlAdapter(opts: {
  bot: DiscordBot;
  channelId: string;
  log?: (msg: string) => void;
}): HitlDiscordBot {
  const log = opts.log ?? (() => {});
  const buttonHandlers = new Set<(q: DiscordButtonQuery) => void | Promise<void>>();

  // Single onInteraction handler dispatches to every registered
  // buttonHandler. Discord interaction `type=3` is MESSAGE_COMPONENT;
  // `data.component_type=2` narrows to button taps (the only kind
  // HITL emits).
  // monad's DiscordBot.onInteraction is a single-slot callback (set
  // at construction). We attach our handler via the constructor
  // path; existing slash-router handlers must be merged externally
  // when both wires share the same bot.
  // Note: `bot.onInteraction` already wired at construction (see
  // `createNexusDiscordHitlHandle` below). The `bot` parameter here
  // is only used for `sendMessageWithComponents` / `editMessage` /
  // `respondToInteraction`.
  void log;

  return {
    async sendButtons(channelId, text, buttons) {
      const components = [{
        type: 1, // ACTION_ROW
        components: buttons.map((b) => ({
          type: 2, // BUTTON
          style: b.style === 'danger' ? 4 : b.style === 'secondary' ? 2 : 1, // SECONDARY=2 / PRIMARY=1 / DANGER=4
          label: b.label,
          custom_id: b.customId,
        })),
      }];
      const sent = await opts.bot.sendMessageWithComponents(channelId, text, components);
      return sent ? { messageId: sent.id } : undefined;
    },
    onButtonClick(handler) {
      buttonHandlers.add(handler);
    },
    async editMessage(channelId, messageId, text) {
      await opts.bot.editMessage(channelId, messageId, text);
    },
    /** Internal — invoked from the bot's onInteraction wire below.
     *  Exposed via a property so the factory can route raw events
     *  into this adapter. */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __dispatchButton: async (q: DiscordButtonQuery): Promise<void> => {
      // Fan out to every registered handler. confirm.ts's adapter
      // registers exactly one (the channel's own listener); future
      // multi-listener support comes for free.
      for (const h of buttonHandlers) {
        try { await h(q); }
        catch (err) { /* swallow */ void err; }
      }
    },
  } as HitlDiscordBot & { __dispatchButton: (q: DiscordButtonQuery) => Promise<void> };
}

interface RawInteraction {
  type?: number;
  id?: string;
  token?: string;
  channel_id?: string;
  data?: {
    component_type?: number;
    custom_id?: string;
  };
}

export function createNexusDiscordHitlHandle(opts: NexusDiscordHitlOpts): NexusDiscordHitlHandle | null {
  if (!opts.token) return null;
  if (!opts.channelId) return null;

  const log = opts.log ?? ((msg: string) => { console.warn(`[hitl/discord] ${msg}`); });

  // Forward declaration so the onInteraction handler can reach the
  // adapter for dispatch. Created lazily after the bot exists.
  let adapter: ReturnType<typeof createDiscordBotHitlAdapter> & {
    __dispatchButton: (q: DiscordButtonQuery) => Promise<void>;
  };

  const onMessageNoOp: DcMessageHandler = async () => undefined;

  const onInteraction = async (raw: Record<string, unknown>): Promise<void> => {
    const r = raw as RawInteraction;
    // type=3 = MESSAGE_COMPONENT; data.component_type=2 = BUTTON.
    if (r.type !== 3) return;
    if (r.data?.component_type !== 2) return;
    if (!r.data.custom_id) return;
    if (!r.id || !r.token) return;
    const channelId = r.channel_id ?? opts.channelId;
    const interactionId = r.id;
    const interactionToken = r.token;
    const customId = r.data.custom_id;
    const q: DiscordButtonQuery = {
      customId,
      channelId,
      ack: async (text?: string): Promise<void> => {
        // type=4 = CHANNEL_MESSAGE_WITH_SOURCE; flags=64 = EPHEMERAL.
        try {
          await opts.bot!.respondToInteraction(interactionId, interactionToken, {
            type: 4,
            data: {
              content: text ?? '✓',
              flags: 64,
            },
          });
        } catch (err) {
          log(`ack failed for ${customId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
    await adapter.__dispatchButton(q);
  };

  const botWasInjected = opts.bot !== undefined;
  const bot = opts.bot ?? new DiscordBot({
    token: opts.token,
    allowedUsers: [],
    onMessage: onMessageNoOp,
    log,
    onInteraction,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.wsImpl ? { wsImpl: opts.wsImpl } : {}),
  });

  // The ack closure needs a stable bot reference; we pin opts.bot
  // post-construction so the closure resolves to either the user-
  // supplied bot or the freshly-constructed one.
  opts.bot = bot;

  adapter = createDiscordBotHitlAdapter({ bot, channelId: opts.channelId, log }) as typeof adapter;

  const deps = createDiscordHitlPostDeps({ bot: adapter, channelId: opts.channelId });
  const channel = createDiscordConfirmChannel(deps);

  // Only start the gateway connection when we own the bot's
  // lifecycle. Tests inject opts.bot and drive interaction events
  // through the adapter manually — no network.
  if (!botWasInjected) {
    void bot.start().catch((err: unknown) => {
      log(`bot.start exited with error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return {
    channel,
    stop: async (): Promise<void> => {
      try { bot.stop(); } catch { /* swallow */ }
    },
  };
}

/** Test-only: expose the adapter's internal dispatch hook so unit
 *  tests can simulate a button click without a real Discord
 *  gateway. Production code goes through the bot's own
 *  onInteraction wire. */
export function dispatchTestButtonClick(
  adapter: HitlDiscordBot,
  q: DiscordButtonQuery,
): Promise<void> {
  return (adapter as HitlDiscordBot & { __dispatchButton: (q: DiscordButtonQuery) => Promise<void> }).__dispatchButton(q);
}
