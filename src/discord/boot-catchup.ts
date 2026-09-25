// Step 1 of platform-evolution arc · PR c — discord boot catch-up.
//
// Mirrors src/telegram/boot-catchup.ts but uses plain-text rendering
// (Discord's parser handles **bold** + backticks natively) and the
// 2000-char per-message cap.

import {
  runChannelBootCatchUp,
  type ChannelCatchUpRenderer,
} from '../channel/boot-catchup.js';
import { splitForDiscord } from '../discord.js';
import type { LLMMessage } from '../llm.js';

export interface DiscordCatchUpBridgeView {
  listDaemonBindings(): Array<{
    channelId: string;
    sessionId: string;
    lastSeenMsgIdx: number;
  }>;
  advanceCursor(channelId: string, newIdx: number): void;
}

export type DiscordCatchUpSendMessage = (
  channelId: string,
  text: string,
) => Promise<unknown>;

export interface DiscordBootCatchUpOpts {
  perChatLimit?: number;
  log?: (msg: string) => void;
}

/** Render the missed message slice as discord-friendly chunks
 *  (plain text with role gutter prefixes). 2000-char cap → split via
 *  splitForDiscord. */
function renderDiscordCatchUp(messages: LLMMessage[], header: string): string[] {
  if (messages.length === 0) return [];
  const lines: string[] = [header, ''];
  for (const m of messages) {
    // System messages and tool-use blocks aren't useful in a chat
    // catch-up — surface user + assistant text only.
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const role = m.role === 'user' ? '👤' : '🤖';
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c: { type?: string; text?: string }) => c?.type === 'text' ? c.text ?? '' : '').filter(Boolean).join('\n')
        : '';
    if (!text.trim()) continue;
    lines.push(`${role} ${text}`);
    lines.push('');
  }
  const joined = lines.join('\n').trim();
  if (!joined) return [];
  return splitForDiscord(joined);
}

export async function runDiscordBootCatchUp(
  bridge: DiscordCatchUpBridgeView,
  sendMessage: DiscordCatchUpSendMessage,
  opts: DiscordBootCatchUpOpts = {},
): Promise<number> {
  const render: ChannelCatchUpRenderer = (missed, { sessionId, limit }) => {
    // Apply the per-chat limit at the visible-message level (skip
    // system entries first, then take the last `limit`).
    const visible = missed.filter((m) => m.role === 'user' || m.role === 'assistant');
    const trimmed = visible.length > limit ? visible.slice(-limit) : visible;
    const omittedCount = visible.length - trimmed.length;
    const headerExtra = omittedCount > 0
      ? ` (${omittedCount} earlier turn${omittedCount === 1 ? '' : 's'} omitted)`
      : '';
    return renderDiscordCatchUp(
      trimmed,
      `↩ While you were away — \`${sessionId}\`${headerExtra}:`,
    );
  };

  return runChannelBootCatchUp<string>({
    bindings: bridge.listDaemonBindings().map((b) => ({
      chatKey: b.channelId,
      sessionId: b.sessionId,
      lastSeenMsgIdx: b.lastSeenMsgIdx,
    })),
    advanceCursor: (channelId, tail) => bridge.advanceCursor(channelId, tail),
    render,
    send: async (channelId, text) => { await sendMessage(channelId, text); },
    perChatLimit: opts.perChatLimit,
    log: opts.log,
  });
}
