import type { DiscordObservedVoiceState } from './discord-voice-gateway-adapter.js';

export interface DiscordVoiceChannelAutoLeaveDeps {
  guildId: string;
  channelId: string;
  requesterUserId: string;
  botUserId?: string | null;
  leave: () => Promise<void>;
  log?: (msg: string) => void;
}

export interface DiscordVoiceChannelAutoLeaveMonitor {
  onVoiceState(state: DiscordObservedVoiceState): void;
}

/** Caller-default showroom flow helper.
 *
 * Tracks the join requester's presence in the active voice channel and
 * auto-leaves once that caller exits. We intentionally scope this to
 * the caller-default path rather than trying to infer full guild voice
 * occupancy without a cache/REST snapshot. */
export function createDiscordVoiceChannelAutoLeaveMonitor(
  deps: DiscordVoiceChannelAutoLeaveDeps,
): DiscordVoiceChannelAutoLeaveMonitor {
  let requesterInChannel = true;
  let leaving = false;
  const log = deps.log ?? (() => {});

  function onVoiceState(state: DiscordObservedVoiceState): void {
    if (leaving) return;
    if (state.guildId !== deps.guildId) return;
    if (state.userId === deps.botUserId) return;
    if (state.userId !== deps.requesterUserId) return;
    requesterInChannel = state.channelId === deps.channelId;
    if (requesterInChannel) return;
    leaving = true;
    void deps.leave().catch((err: unknown) => {
      leaving = false;
      log(`[voice.discord] auto-leave failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return { onVoiceState };
}
