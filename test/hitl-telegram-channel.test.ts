import { describe, expect, test } from 'bun:test';

import { createTelegramHitlPostDeps } from '../src/hitl/telegram-channel.js';
import { TelegramBot, type TgCallbackQuery } from '../src/telegram.js';
import { createTelegramConfirmChannel } from '../src/hitl/confirm.js';

function mkBot(opts: {
  sendResult?: { messageId: number };
  captureSend?: (body: Record<string, unknown>) => void;
  captureAnswer?: (body: Record<string, unknown>) => void;
  captureEditText?: (body: Record<string, unknown>) => void;
  captureEditMarkup?: (body: Record<string, unknown>) => void;
} = {}): TelegramBot {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.includes('sendMessage')) {
      opts.captureSend?.(body);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: opts.sendResult?.messageId ?? 1 },
      }), { status: 200 });
    }
    if (url.includes('answerCallbackQuery')) {
      opts.captureAnswer?.(body);
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    if (url.includes('editMessageReplyMarkup')) {
      opts.captureEditMarkup?.(body);
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    if (url.includes('editMessageText')) {
      opts.captureEditText?.(body);
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  };
  return new TelegramBot({
    token: 'test:123', allowedUsers: [], onMessage: async () => undefined, fetchImpl: fakeFetch,
    perChatGapMs: 0,  // no throttle in tests; the cancel polish path
                     // emits two API calls back-to-back and the
                     // 900ms default would balloon test runtime.
    streamEditGapMs: 0,
  });
}

// Helper: simulate the bot receiving a callback_query update. We
// call the private dispatch path by invoking the registered handler
// directly — the TelegramBot.onCallbackQuery surface is the public
// registration, the test drives the handler without running the
// long-poll.
async function deliverCallback(
  bot: TelegramBot,
  q: TgCallbackQuery,
): Promise<void> {
  // Poke one registered handler. We can't access the Set directly,
  // but simulating via re-using onCallbackQuery gives us an extra
  // handler — that's fine for the tests. The channel's handler is
  // subscribed inside createTelegramHitlPostDeps and fires first.
  // Use the same event shape the poller would emit.
  //
  // Instead: retrieve the private callbackHandlers Set via a cast.
  const handlers = (bot as unknown as { callbackHandlers: Set<(q: TgCallbackQuery) => Promise<void> | void> }).callbackHandlers;
  for (const h of handlers) { await h(q); }
}

describe('createTelegramHitlPostDeps', () => {
  test('post() sends a Y/N inline keyboard and returns an answer promise', async () => {
    const sent: Record<string, unknown>[] = [];
    const bot = mkBot({ captureSend: (b) => sent.push(b) });
    const deps = createTelegramHitlPostDeps({ bot, chatId: 123 });
    const handle = await deps.post({
      prompt: 'Proceed?',
      detail: 'Writes 40 bytes to pane:abc',
      yesLabel: 'Go',
      noLabel: 'Stop',
      requestId: 'req-001',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chat_id).toBe(123);
    const text = sent[0]!.text as string;
    expect(text).toContain('Proceed?');
    expect(text).toContain('Writes 40 bytes');
    const rm = sent[0]!.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(rm.inline_keyboard[0]![0]!.callback_data).toBe('elanous-hitl:req-001:yes');
    expect(rm.inline_keyboard[0]![0]!.text).toBe('Go');
    expect(rm.inline_keyboard[0]![1]!.callback_data).toBe('elanous-hitl:req-001:no');
    expect(handle.answer).toBeInstanceOf(Promise);
  });

  test('a yes callback resolves the pending promise to true', async () => {
    const bot = mkBot();
    const deps = createTelegramHitlPostDeps({ bot, chatId: 111 });
    const handle = await deps.post({ prompt: 'ok?', requestId: 'r1' });
    await deliverCallback(bot, {
      id: 'cq1',
      userId: 1,
      chatId: 111,
      messageId: 1,
      data: 'elanous-hitl:r1:yes',
    });
    expect(await handle.answer).toBe(true);
  });

  test('a no callback resolves to false', async () => {
    const bot = mkBot();
    const deps = createTelegramHitlPostDeps({ bot, chatId: 111 });
    const handle = await deps.post({ prompt: 'ok?', requestId: 'r2' });
    await deliverCallback(bot, {
      id: 'cq2', userId: 1, chatId: 111, messageId: 1,
      data: 'elanous-hitl:r2:no',
    });
    expect(await handle.answer).toBe(false);
  });

  test('cancel() resolves pending to null without hitting the API', async () => {
    const bot = mkBot();
    const deps = createTelegramHitlPostDeps({ bot, chatId: 111 });
    const handle = await deps.post({ prompt: 'ok?', requestId: 'r3' });
    await handle.cancel();
    expect(await handle.answer).toBeNull();
  });

  test('callbacks with unknown requestId are acked and ignored', async () => {
    const acks: Record<string, unknown>[] = [];
    const bot = mkBot({ captureAnswer: (b) => acks.push(b) });
    createTelegramHitlPostDeps({ bot, chatId: 111 });
    await deliverCallback(bot, {
      id: 'cq-ghost', userId: 1, chatId: 111, messageId: 1,
      data: 'elanous-hitl:ghost:yes',
    });
    expect(acks.length).toBe(1);
    expect(acks[0]!.text).toContain('expired');
  });

  test('non-elanous-hitl callbacks pass through (not handled)', async () => {
    const acks: Record<string, unknown>[] = [];
    const bot = mkBot({ captureAnswer: (b) => acks.push(b) });
    createTelegramHitlPostDeps({ bot, chatId: 111 });
    await deliverCallback(bot, {
      id: 'cq-other', userId: 1, chatId: 111, messageId: 1,
      data: 'something:else',
    });
    expect(acks.length).toBe(0);
  });

  test('wraps nicely into createTelegramConfirmChannel', async () => {
    const bot = mkBot();
    const deps = createTelegramHitlPostDeps({ bot, chatId: 111 });
    const channel = createTelegramConfirmChannel(deps);
    expect(channel.name).toBe('telegram');
    const p = channel.request({ prompt: 'hi', requestId: 'req-wrap' });
    // Let the inner `await deps.post(...)` complete so the pending
    // map has an entry before we deliver the callback.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await deliverCallback(bot, {
      id: 'cq', userId: 1, chatId: 111, messageId: 1,
      data: 'elanous-hitl:req-wrap:yes',
    });
    expect(await p).toBe(true);
  });

  // β-1 dismiss polish (2026-05-08) — sibling-channel-wins UX.
  describe('cancel() · sibling channel won the race', () => {
    test('default → editMessageText("✗ cancelled by other device") + clearMessageReplyMarkup', async () => {
      const edits: Record<string, unknown>[] = [];
      const markups: Record<string, unknown>[] = [];
      const bot = mkBot({
        captureEditText: (b) => edits.push(b),
        captureEditMarkup: (b) => markups.push(b),
        sendResult: { messageId: 7 },
      });
      const deps = createTelegramHitlPostDeps({ bot, chatId: 222 });
      const handle = await deps.post({ prompt: 'OK?', requestId: 'req-cancel' });

      await handle.cancel();
      expect(edits).toHaveLength(1);
      expect(edits[0]!.chat_id).toBe(222);
      expect(edits[0]!.message_id).toBe(7);
      expect(edits[0]!.text).toBe('✗ cancelled by other device');
      expect(markups).toHaveLength(1);
      expect(markups[0]!.message_id).toBe(7);
      const rm = markups[0]!.reply_markup as { inline_keyboard: unknown[] };
      expect(rm.inline_keyboard).toEqual([]);
    });

    test('cancelText="" → only clearMessageReplyMarkup (skip text edit)', async () => {
      const edits: Record<string, unknown>[] = [];
      const markups: Record<string, unknown>[] = [];
      const bot = mkBot({
        captureEditText: (b) => edits.push(b),
        captureEditMarkup: (b) => markups.push(b),
        sendResult: { messageId: 9 },
      });
      const deps = createTelegramHitlPostDeps({ bot, chatId: 333, cancelText: '' });
      const handle = await deps.post({ prompt: 'OK?', requestId: 'req-no-text' });

      await handle.cancel();
      expect(edits).toHaveLength(0);
      expect(markups).toHaveLength(1);
    });

    test('cancelText=null → legacy behavior (no edit, no clear)', async () => {
      const edits: Record<string, unknown>[] = [];
      const markups: Record<string, unknown>[] = [];
      const bot = mkBot({
        captureEditText: (b) => edits.push(b),
        captureEditMarkup: (b) => markups.push(b),
        sendResult: { messageId: 11 },
      });
      const deps = createTelegramHitlPostDeps({ bot, chatId: 444, cancelText: null });
      const handle = await deps.post({ prompt: 'OK?', requestId: 'req-legacy' });

      await handle.cancel();
      expect(edits).toHaveLength(0);
      expect(markups).toHaveLength(0);
    });

    test('custom cancelText is forwarded to editMessageText', async () => {
      const edits: Record<string, unknown>[] = [];
      const bot = mkBot({
        captureEditText: (b) => edits.push(b),
        sendResult: { messageId: 13 },
      });
      const deps = createTelegramHitlPostDeps({
        bot, chatId: 555, cancelText: 'race winner: PWA',
      });
      const handle = await deps.post({ prompt: 'OK?', requestId: 'req-custom' });
      await handle.cancel();
      expect(edits[0]!.text).toBe('race winner: PWA');
    });

    test('cancel after a stale call (entry already removed) is a no-op', async () => {
      const edits: Record<string, unknown>[] = [];
      const bot = mkBot({
        captureEditText: (b) => edits.push(b),
        sendResult: { messageId: 15 },
      });
      const deps = createTelegramHitlPostDeps({ bot, chatId: 666 });
      const handle = await deps.post({ prompt: 'OK?', requestId: 'req-double' });
      await handle.cancel();
      const editsAfterFirst = edits.length;
      await handle.cancel();
      expect(edits.length).toBe(editsAfterFirst);
    });
  });
});
