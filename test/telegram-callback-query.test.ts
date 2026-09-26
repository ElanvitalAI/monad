import { describe, expect, test } from 'bun:test';

import { TelegramBot, parseUpdate } from '../src/telegram.js';

describe('Telegram inline-keyboard + callback_query (T2-P6)', () => {
  test('sendInlineKeyboard posts reply_markup with button rows', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const bot = new TelegramBot({
      token: 'test:123',
      allowedUsers: [],
      onMessage: async () => undefined,
      fetchImpl: fakeFetch,
    });
    const r = await bot.sendInlineKeyboard(111, 'Approve?', [
      [
        { text: 'Yes', data: 'elanous-hitl:req:yes' },
        { text: 'No',  data: 'elanous-hitl:req:no'  },
      ],
    ]);
    expect(r?.messageId).toBe(42);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain('sendMessage');
    const rm = calls[0]!.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(rm.inline_keyboard.length).toBe(1);
    expect(rm.inline_keyboard[0]!.length).toBe(2);
    expect(rm.inline_keyboard[0]![0]!.text).toBe('Yes');
    expect(rm.inline_keyboard[0]![0]!.callback_data).toBe('elanous-hitl:req:yes');
  });

  test('callback_data is truncated to 64 bytes', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      calls.push({ body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    };
    const bot = new TelegramBot({
      token: 'test:123', allowedUsers: [], onMessage: async () => undefined, fetchImpl: fakeFetch,
    });
    const long = 'x'.repeat(200);
    await bot.sendInlineKeyboard(1, 'ok', [[{ text: 'a', data: long }]]);
    const rm = calls[0]!.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(rm.inline_keyboard[0]![0]!.callback_data.length).toBe(64);
  });

  test('answerCallbackQuery hits the REST endpoint', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };
    const bot = new TelegramBot({
      token: 'test:123', allowedUsers: [], onMessage: async () => undefined, fetchImpl: fakeFetch,
    });
    await bot.answerCallbackQuery('cq-1', { text: 'ack', alert: false });
    expect(calls[0]!.url).toContain('answerCallbackQuery');
    expect(calls[0]!.body.callback_query_id).toBe('cq-1');
    expect(calls[0]!.body.text).toBe('ack');
  });

  test('onCallbackQuery returns an unsubscribe fn', () => {
    const bot = new TelegramBot({
      token: 'test:123', allowedUsers: [], onMessage: async () => undefined,
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true, result: [] }))) as unknown as typeof fetch,
    });
    const unsub = bot.onCallbackQuery(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  test('parseUpdate returns null for callback_query-only updates (routed separately)', () => {
    const u = {
      update_id: 1,
      callback_query: {
        id: 'cq-1',
        from: { id: 99, first_name: 'Alice' },
        message: { message_id: 10, chat: { id: 111, type: 'private' as const } },
        data: 'elanous-hitl:req:yes',
      },
    } as never;
    // callback_query has no `message`, so parseUpdate (which only
    // handles messages) returns null — the poller handles callback
    // queries in a dedicated branch.
    expect(parseUpdate(u)).toBeNull();
  });
});
