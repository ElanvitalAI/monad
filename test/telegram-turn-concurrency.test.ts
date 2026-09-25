// Poll-loop concurrency — the enabler for same-bot HITL.
//
// A turn (e.g. `/cc` or a delegate_code_agent tool call) blocks while a
// delegated sub-agent waits for a human approval. The approval arrives
// as a `callback_query` update. If the poll loop `await`ed each turn to
// completion, it could never fetch that callback → the turn deadlocks
// on its own approval until it times out. This test proves the loop
// keeps polling (and routes the callback) WHILE a turn is blocked.

import { describe, expect, test } from 'bun:test';
import { TelegramBot } from '../src/telegram';

const FAST = { errorBackoffMs: 0, pollTimeoutSec: 0, perChatGapMs: 0, streamEditGapMs: 0 } as const;

interface Call { url: string; body: any }
function makeStub(responder: (call: Call) => any): { fetchImpl: typeof fetch } {
  const fetchImpl: any = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    return { json: async () => ({ ok: true, result: responder({ url, body }) }) };
  };
  return { fetchImpl };
}

describe('telegram poll loop · turn concurrency', () => {
  test('a callback_query is fetched + routed WHILE a turn is blocked on it (no HITL deadlock)', async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((r) => { openGate = r; });
    let turnStarted = false;
    let turnFinished = false;
    let callbackFired = false;

    let bot!: TelegramBot;
    let poll = 0;
    const { fetchImpl } = makeStub((call) => {
      if (call.url.endsWith('getUpdates')) {
        poll += 1;
        if (poll === 1) {
          return [{ update_id: 1, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: 'hello' } }];
        }
        if (poll === 2) {
          // The "approval tap" — only reachable if the loop kept polling
          // instead of blocking on poll #1's turn.
          return [{ update_id: 2, callback_query: { id: 'cb1', from: { id: 42 }, data: 'go', message: { message_id: 1, chat: { id: 42, type: 'private' } } } }];
        }
        bot.stop();
        return [];
      }
      if (call.url.endsWith('/sendMessage')) return { message_id: 777 };
      return {};
    });

    bot = new TelegramBot({
      token: 't',
      allowedUsers: [42],
      // The turn blocks until the approval callback resolves the gate —
      // exactly the HITL wait shape.
      onMessage: async () => { turnStarted = true; await gate; turnFinished = true; return 'done'; },
      fetchImpl,
      ...FAST,
    });
    // Register a callback handler → poll loop starts requesting
    // callback_query updates, and this resolves the blocked turn.
    bot.onCallbackQuery((q) => {
      if (q.data === 'go') { callbackFired = true; openGate(); }
    });

    // If the loop blocked on the turn, poll #2 never happens, the gate
    // never opens, and this await would hang until the test timeout.
    await bot.start();

    expect(turnStarted).toBe(true);
    expect(callbackFired).toBe(true);
    expect(turnFinished).toBe(true);
  });

  test('a pending "Other" text capture consumes the next message inline (not as a turn)', async () => {
    let captured: string | null | undefined;
    let onMessageCalls = 0;

    let bot!: TelegramBot;
    let poll = 0;
    const { fetchImpl } = makeStub((call) => {
      if (call.url.endsWith('getUpdates')) {
        poll += 1;
        if (poll === 1) {
          return [{ update_id: 1, message: { message_id: 1, from: { id: 42 }, chat: { id: 42, type: 'private' }, text: 'my typed answer' } }];
        }
        bot.stop();
        return [];
      }
      if (call.url.endsWith('/sendMessage')) return { message_id: 1 };
      return {};
    });

    bot = new TelegramBot({
      token: 't',
      allowedUsers: [42],
      onMessage: async (ctx) => { onMessageCalls += 1; return `echo ${ctx.text}`; },
      fetchImpl,
      ...FAST,
    });
    // Arm the capture (as the question channel's Other step would).
    bot.captureNextText(42, undefined, (t) => { captured = t; });

    await bot.start();

    expect(captured).toBe('my typed answer');
    expect(onMessageCalls).toBe(0); // consumed inline, NOT run as a turn
  });
});
