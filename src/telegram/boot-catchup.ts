// Tier 1 telegram fan-out arc — PR 4 · boot catch-up.
//
// Step 1 of platform-evolution arc · PR c — this module is now a
// telegram-shaped wrapper over src/channel/boot-catchup.ts. The
// shared runner does the diff-cursor walk + digest delivery; this
// wrapper supplies telegram-specific render (HTML via
// renderTelegramReplayPreviewHtml) and sendMessage glue.

import { renderTelegramReplayPreviewHtml } from './replay-preview.js';
import {
  runChannelBootCatchUp,
  type ChannelCatchUpRenderer,
} from '../channel/boot-catchup.js';

/** Minimal interface the catch-up needs from the bridge. Defined
 *  inline (not imported) so this module doesn't depend on
 *  telegram-acp-bridge.ts directly. */
export interface CatchUpBridgeView {
  listDaemonBindings(): Array<{
    chatId: number;
    threadId: number;
    sessionId: string;
    lastSeenMsgIdx: number;
  }>;
  advanceCursor(chatId: number, threadId: number | undefined, newIdx: number): void;
}

export type CatchUpSendMessage = (
  chatId: number,
  text: string,
  opts: { parseMode: 'HTML' },
) => Promise<unknown>;

export interface BootCatchUpOpts {
  perChatLimit?: number;
  log?: (msg: string) => void;
}

interface TelegramChatKey {
  chatId: number;
  threadId: number;
}

/** Walk every persisted binding; for each chat emit a digest of the
 *  daemon's jsonl tail past the cursor, then advance the cursor to
 *  the new tail. Returns the count of chats that received a digest. */
export async function runTelegramBootCatchUp(
  bridge: CatchUpBridgeView,
  sendMessage: CatchUpSendMessage,
  opts: BootCatchUpOpts = {},
): Promise<number> {
  const render: ChannelCatchUpRenderer = (missed, { sessionId, limit }) => {
    const previews = renderTelegramReplayPreviewHtml(missed, {
      limit,
      header: `↩ While you were away (<code>${sessionId}</code>):`,
      moreFooterPrefix: '_…earlier missed turns omitted, total:_',
    });
    return previews.map((p) => p.html);
  };

  return runChannelBootCatchUp<TelegramChatKey>({
    bindings: bridge.listDaemonBindings().map((b) => ({
      chatKey: { chatId: b.chatId, threadId: b.threadId },
      sessionId: b.sessionId,
      lastSeenMsgIdx: b.lastSeenMsgIdx,
    })),
    advanceCursor: (key, tail) => bridge.advanceCursor(key.chatId, key.threadId, tail),
    render,
    send: async (key, text) => { await sendMessage(key.chatId, text, { parseMode: 'HTML' }); },
    perChatLimit: opts.perChatLimit,
    log: opts.log,
  });
}
