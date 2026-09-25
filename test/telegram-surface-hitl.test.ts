// Surface-scoped Telegram HITL — the confirm channel that routes a
// delegated ACP agent's permission prompt back to the exact chat that
// triggered the mission. We drive a fake TelegramBot (capturing the
// single onCallbackQuery subscription) and assert:
//   - request() posts an inline keyboard to the RIGHT chat
//   - a matching callback resolves the awaiting promise with the tap
//   - callbacks route by requestId — chat A's tap never resolves chat B
//   - cancel() dismisses the prompt and resolves null (race fall-through)

import { describe, expect, test } from 'bun:test';

import { createTelegramSurfaceHitl } from '../src/hitl/telegram-surface-hitl';
import type { TgCallbackQuery } from '../src/telegram';

/** Drain microtasks + one macrotask so an in-flight `request()` finishes
 *  posting and registers its pending entry before we fire a callback. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

interface SentKeyboard {
  chatId: number;
  text: string;
  buttons: Array<Array<{ text: string; data: string }>>;
  threadId?: number;
}

function makeFakeBot() {
  const sent: SentKeyboard[] = [];
  const acks: Array<{ id: string; text?: string }> = [];
  const cleared: Array<{ chatId: number; messageId: number }> = [];
  const edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  let cbHandler: ((q: TgCallbackQuery) => Promise<void> | void) | null = null;
  let nextMid = 1000;

  const bot = {
    onCallbackQuery(handler: (q: TgCallbackQuery) => Promise<void> | void) {
      cbHandler = handler;
      return () => { cbHandler = null; };
    },
    async sendInlineKeyboard(
      chatId: number,
      text: string,
      buttons: Array<Array<{ text: string; data: string }>>,
      opts: { replyTo?: number; threadId?: number } = {},
    ) {
      sent.push({ chatId, text, buttons, threadId: opts.threadId });
      return { messageId: nextMid++ };
    },
    async answerCallbackQuery(id: string, opts: { text?: string } = {}) {
      acks.push({ id, text: opts.text });
    },
    async clearMessageReplyMarkup(chatId: number, messageId: number) {
      cleared.push({ chatId, messageId });
    },
    async editMessageText(chatId: number, messageId: number, text: string) {
      edits.push({ chatId, messageId, text });
    },
  };

  return {
    bot,
    sent,
    acks,
    cleared,
    edits,
    fireCallback(data: string, id = 'cb-1') {
      if (!cbHandler) throw new Error('no callback handler registered');
      return cbHandler({ id, userId: 1, data } as TgCallbackQuery);
    },
    dataFor(index: number, decision: 'yes' | 'no'): string {
      const btn = sent[index]!.buttons[0]!.find((b) => b.data.endsWith(`:${decision}`));
      if (!btn) throw new Error('button not found');
      return btn.data;
    },
  };
}

describe('createTelegramSurfaceHitl', () => {
  test('subscribes exactly once, regardless of how many chat channels are handed out', () => {
    const fake = makeFakeBot();
    let subs = 0;
    const spyBot = {
      ...fake.bot,
      onCallbackQuery(h: (q: TgCallbackQuery) => Promise<void> | void) {
        subs += 1;
        return fake.bot.onCallbackQuery(h);
      },
    };
    const hitl = createTelegramSurfaceHitl(spyBot as never);
    hitl.confirmChannelForChat(1);
    hitl.confirmChannelForChat(2);
    hitl.confirmChannelForChat(3);
    expect(subs).toBe(1);
  });

  test('request() posts to the triggering chat + thread and resolves on tap', async () => {
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    const ch = hitl.confirmChannelForChat(42, 7);

    const answer = ch.request({ prompt: 'claude wants to edit foo.ts', requestId: 'req-A' });
    await flush();

    // Posted to the right chat + thread. callback_data uses a SHORT
    // internal token — NOT the requestId (which can overrun 64 bytes).
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.chatId).toBe(42);
    expect(fake.sent[0]!.threadId).toBe(7);
    const yesData = fake.dataFor(0, 'yes');
    expect(yesData).toStartWith('monad-hitl:');
    expect(yesData).toEndWith(':yes');
    expect(yesData).not.toContain('req-A');
    expect(yesData.length).toBeLessThanOrEqual(64);

    // User taps Approve (fire the ACTUAL button data).
    await fake.fireCallback(yesData);
    expect(await answer).toBe(true);
    // Acked + prompt edited to a clear status + buttons cleared.
    expect(last(fake.acks)?.text).toContain('승인');
    expect(last(fake.edits)?.text).toContain('승인됨');
    // The ack is a POINT-IN-TIME confirmation, NOT a live progress claim —
    // it must not say "진행 중…" (nothing updates it on turn completion, so
    // it would linger and contradict the separate completion message).
    expect(last(fake.edits)?.text).not.toContain('진행 중');
  });

  test('a reject tap resolves false', async () => {
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    const ch = hitl.confirmChannelForChat(5);
    const answer = ch.request({ prompt: 'run rm -rf?', requestId: 'req-R' });
    await flush();
    await fake.fireCallback(fake.dataFor(0, 'no'));
    expect(await answer).toBe(false);
  });

  test('regression: a long/colon-heavy ACP requestId still resolves on tap', async () => {
    // The bug: ACP mints `acp-perm-acp-cli:claude:<uuid>-<ts>` as requestId;
    // embedding it in callback_data overran Telegram's 64-byte cap
    // (dropping `:yes`) AND broke split(':'), so taps never matched and the
    // turn hung to the 120s HITL timeout. The short-token fix keeps the tap
    // matchable no matter how long/colon-heavy the requestId is.
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    const ch = hitl.confirmChannelForChat(77);
    const longId = 'acp-perm-acp-cli:claude:01KX3Q0C52P415SC1754C91VKG-abc123def';
    const answer = ch.request({ prompt: 'claude wants to find …', requestId: longId });
    await flush();
    const yesData = fake.dataFor(0, 'yes');
    expect(yesData.length).toBeLessThanOrEqual(64); // fits — no truncation
    await fake.fireCallback(yesData);
    expect(await answer).toBe(true);
  });

  test('callbacks route by requestId — chat A tap does not resolve chat B', async () => {
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    const chA = hitl.confirmChannelForChat(100);
    const chB = hitl.confirmChannelForChat(200);

    const ansA = chA.request({ prompt: 'A?', requestId: 'A1' });
    const ansB = chB.request({ prompt: 'B?', requestId: 'B1' });
    await flush();
    expect(fake.sent.map((s) => s.chatId)).toEqual([100, 200]);

    // Resolve only A (fire A's actual button data — token 0).
    await fake.fireCallback(fake.dataFor(0, 'yes'));
    expect(await ansA).toBe(true);

    // B is still pending — resolve it independently (token 1).
    await fake.fireCallback(fake.dataFor(1, 'no'));
    expect(await ansB).toBe(false);
  });

  test('unknown / expired requestId is ignored (no ack stomping)', async () => {
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    hitl.confirmChannelForChat(1); // no pending request
    await fake.fireCallback('monad-hitl:nope:yes');
    // Did not answer the callback — leaves it for a sibling handler.
    expect(fake.acks).toHaveLength(0);
  });

  test('cancel() dismisses the prompt and resolves null (race fall-through)', async () => {
    const fake = makeFakeBot();
    const hitl = createTelegramSurfaceHitl(fake.bot as never);
    const ch = hitl.confirmChannelForChat(9);
    const answer = ch.request({ prompt: 'need approval', requestId: 'req-C' });
    await flush();
    await ch.cancel();
    expect(await answer).toBeNull();
    expect(last(fake.edits)?.text).toContain('cancelled');
  });
});
