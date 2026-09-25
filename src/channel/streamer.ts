// Step 1 of platform-evolution arc — channel-agnostic streamer base.
//
// PLAN-discord-ambient-merge.md §2 D12=A — minimal contract that
// covers what telegram + discord both already do (edit + finalize).
// Future channels (Slack, iMessage) extend this when they land —
// their PR adopts UTF-16 batching / split detection / per-channel
// throttle from RESEARCH-gateway-multichannel-telegram §B.4 at that
// time, not now (YAGNI; over-abstract risk = 0 with 2 channels).
//
// Concrete adapters (TelegramStreamerAdapter, DiscordStreamerAdapter)
// live next to their bot module — they wrap the channel-specific
// streamer the bot already exposes (TgMessageStreamer.edit /
// DcMessageStreamer.edit).

export interface ChannelStreamer {
  /** Edit the in-flight message with the cumulative text. Called by
   *  the daemon-bridge during streaming (onText delta path). The
   *  channel-specific rate limit is the implementation's
   *  responsibility — telegram aims at ~1.5s/edit (per-chat 1msg/sec
   *  hard-cap from Bot API), discord ~0.5s. */
  edit(partialText: string): Promise<void>;
  /** Final flush — message becomes immutable in most channels. For
   *  telegram + discord this is functionally identical to a final
   *  edit(); the distinct hook lets future channels with explicit
   *  end-marker (Slack thread close, Matrix m.room.message edits
   *  with rel_type=m.replace) override without changing the
   *  daemon-bridge contract. */
  finalize(text: string): Promise<void>;

  /** P1.4 file spill — optional. When a relayed tool body overflows the
   *  inline cap, the caller spills the FULL body here as an attachment
   *  (Telegram sendDocument / Discord attachment). Optional so a channel
   *  can adopt it independently; an absent impl means the chat keeps just
   *  the truncated inline (graceful, never lossy-silent — the inline note
   *  still says "(truncated N chars)"). Fire-and-forget. */
  sendFile?: import('./file-sink.js').FileSink['sendFile'];
}
