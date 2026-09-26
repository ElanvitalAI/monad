// PR-S1V.11 (sprint 22 Phase 6 · 2026-04-29) — Discord voice channel
// boot helper.
//
// Wires the adapter + dispatcher into the existing dependency-free
// Discord bot. The bot's `onMessage` callback hands raw message
// bodies to caller code (dashboard or daemon); the boot helper
// returns a `dispatchVoiceCommand` function the caller invokes
// before falling through to the default LLM path.
//
// Production usage:
//   const vboot = bootDiscordVoiceChannel({});
//   bot.onMessage = async (msg) => {
//     const reply = await vboot.dispatchVoiceCommand(msg);
//     if (reply !== null) {
//       await bot.send(msg.channelId, reply);
//       return;
//     }
//     // ...normal LLM handling
//   };
//
// Reference: ROADMAP §7.1.

import {
  createDiscordVoiceChannelAdapter,
  createStubDiscordVoiceChannelAdapter,
  isDiscordVoiceChannelEnabled,
  type DiscordVoiceChannelAdapter,
  type DiscordVoiceChannelSession,
  type DiscordVoiceJoinOpts,
} from './discord-voice-channel-adapter.js';
import {
  createDiscordVoiceChannelDispatcher,
  type DiscordVoiceChannelDispatcher,
  type DiscordVoiceCommandContext,
} from './discord-voice-channel-commands.js';
import type { DiscordVoiceGatewayCoordinator } from './discord-voice-gateway-adapter.js';

export interface BootDiscordVoiceChannelOpts {
  /** Override the adapter — tests pass the stub. */
  adapter?: DiscordVoiceChannelAdapter;
  /** Gateway coordinator — required for the production adapter. The
   *  caller (typically `src/index.ts` Discord boot path) wires this
   *  to the bot's voiceTap + sendGatewayPayload. When absent, the
   *  host falls back to a stub explaining the missing wire. */
  coordinator?: DiscordVoiceGatewayCoordinator;
  /** Hook fired when a session starts — wire to elanous voice-chat
   *  pipeline so harness consumes the audio. */
  onSessionStart?: (session: DiscordVoiceChannelSession, opts: DiscordVoiceJoinOpts) => void;
  onSessionEnd?: () => void;
}

export interface BootDiscordVoiceChannelResult {
  enabled: boolean;
  adapter: DiscordVoiceChannelAdapter;
  dispatcher: DiscordVoiceChannelDispatcher;
  /** Convenience — bot caller invokes this first; returns the reply
   *  to send back, or `null` to indicate "not a voice command". */
  dispatchVoiceCommand: (ctx: DiscordVoiceCommandContext) => Promise<string | null>;
  shutdown: () => Promise<void>;
}

export function bootDiscordVoiceChannel(
  opts: BootDiscordVoiceChannelOpts = {},
): BootDiscordVoiceChannelResult {
  const enabled = isDiscordVoiceChannelEnabled();
  // Adapter selection:
  //   - test/explicit: opts.adapter
  //   - env disabled: stub with explanatory unavailable reason so
  //     `/voice-join` returns a helpful message
  //   - env enabled + coordinator wired: production lazy adapter
  //   - env enabled + no coordinator (e.g., Discord bot not booted
  //     yet): stub with "coordinator not wired" reason
  const adapter = opts.adapter ?? buildAdapter(enabled, opts.coordinator);

  const dispatcher = createDiscordVoiceChannelDispatcher({
    adapter,
    ...(opts.onSessionStart ? { onSessionStart: opts.onSessionStart } : {}),
    ...(opts.onSessionEnd ? { onSessionEnd: opts.onSessionEnd } : {}),
  });

  return {
    enabled,
    adapter,
    dispatcher,
    dispatchVoiceCommand: (ctx) => dispatcher.handle(ctx),
    shutdown: () => adapter.shutdown(),
  };
}

function buildAdapter(
  enabled: boolean,
  coordinator: DiscordVoiceGatewayCoordinator | undefined,
): DiscordVoiceChannelAdapter {
  if (!enabled) {
    return createStubDiscordVoiceChannelAdapter({
      failWith: 'ELANOUS_DISCORD_VOICE_CHANNEL is not set',
    });
  }
  if (!coordinator) {
    return createStubDiscordVoiceChannelAdapter({
      failWith: 'voice gateway coordinator not wired (Discord bot must be running with voiceTap)',
    });
  }
  return createDiscordVoiceChannelAdapter({ coordinator });
}
