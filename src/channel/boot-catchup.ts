// Step 1 of platform-evolution arc · PR c — channel-agnostic boot
// catch-up.
//
// Hoisted from src/telegram/boot-catchup.ts so discord (and future
// channels) can reuse the diff-cursor logic. The piece that varies
// per channel is:
//   - the list-bindings shape (telegram's chatId is number,
//     discord's is string)
//   - the renderer (HTML for telegram, plain text for discord)
//   - the sendMessage function (parse_mode=HTML vs plain)
//
// Channel-specific glue lives in src/telegram/boot-catchup.ts (now
// a thin wrapper) and src/discord/boot-catchup.ts (PR c, this PR).

import { readDaemonSessionHistory } from '../telegram/daemon-history-reader.js';
import type { LLMMessage } from '../llm.js';

/** Per-channel binding view that boot catch-up needs. Shape is
 *  intentionally generic: chatKey is whatever the channel uses to
 *  address a chat (telegram = string-encoded chatId+threadId, discord
 *  = channelId snowflake string). The renderer + sendMessage close
 *  over the same chatKey type. */
export interface ChannelCatchUpBinding<ChatKey> {
  chatKey: ChatKey;
  sessionId: string;
  lastSeenMsgIdx: number;
}

/** Render the missed slice of jsonl history into 0+ chunks ready to
 *  send. Each chunk must already fit within the channel's per-message
 *  cap (4096 for telegram, 2000 for discord). Empty array = nothing
 *  to render (e.g. all missed entries were tool-only). */
export type ChannelCatchUpRenderer = (
  missedMessages: LLMMessage[],
  opts: { sessionId: string; limit: number },
) => string[];

/** Send one chunk to the channel. Caller resolves chatKey →
 *  channel-specific args. Errors propagate so the runner can stop
 *  delivering follow-up chunks for the same chat. */
export type ChannelCatchUpSender<ChatKey> = (
  chatKey: ChatKey,
  text: string,
) => Promise<void>;

export interface ChannelBootCatchUpOpts<ChatKey> {
  bindings: Iterable<ChannelCatchUpBinding<ChatKey>>;
  /** Bump the cursor to `tail` after a successful delivery (or after
   *  a tool-only delta where there's nothing to render but we still
   *  want to skip past those entries on the next start). */
  advanceCursor: (chatKey: ChatKey, tail: number) => void;
  render: ChannelCatchUpRenderer;
  send: ChannelCatchUpSender<ChatKey>;
  /** How many missed turns at most to surface per chat. Default 5
   *  (matches the telegram /resume preview limit). */
  perChatLimit?: number;
  log?: (msg: string) => void;
}

/** Walk every persisted binding; for each chat emit a digest of the
 *  daemon's jsonl tail past the cursor, then advance the cursor to
 *  the new tail. Returns the count of chats that received a digest. */
export async function runChannelBootCatchUp<ChatKey>(
  opts: ChannelBootCatchUpOpts<ChatKey>,
): Promise<number> {
  const log = opts.log ?? (() => { /* silent */ });
  const limit = opts.perChatLimit ?? 5;
  let chatsTouched = 0;

  for (const binding of opts.bindings) {
    let result;
    try {
      result = readDaemonSessionHistory(binding.sessionId);
    } catch (e) {
      log(`boot-catchup: read failed for ${binding.sessionId}: ${String(e)}`);
      continue;
    }
    if (!result.exists) continue;
    const tail = result.messages.length;
    if (tail <= binding.lastSeenMsgIdx) continue;

    const missed = result.messages.slice(binding.lastSeenMsgIdx);
    const chunks = opts.render(missed, { sessionId: binding.sessionId, limit });
    if (chunks.length === 0) {
      // All tool-only entries — bump cursor anyway so they don't
      // trigger again on the next start.
      opts.advanceCursor(binding.chatKey, tail);
      continue;
    }

    let delivered = false;
    for (const chunk of chunks) {
      try {
        await opts.send(binding.chatKey, chunk);
        delivered = true;
      } catch (e) {
        log(`boot-catchup: send failed: ${String(e)}`);
        break;
      }
    }
    if (delivered) {
      chatsTouched += 1;
      opts.advanceCursor(binding.chatKey, tail);
    }
  }

  return chatsTouched;
}
