// Surface-unification v2 FU-2 (2026-05-11) — Telegram trigger tap.

import { describe, expect, test } from 'bun:test';
import { TelegramBot, classifyTelegramText, type TgTriggerEvent, type TgIncoming } from '../src/telegram';

function makeStubFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
    text: async () => '',
  });
}

function fakeIncoming(text: string, overrides: Partial<TgIncoming> = {}): TgIncoming {
  return {
    updateId: 1,
    chatId: 100,
    userId: 200,
    userName: 'alice',
    text,
    messageId: 9,
    isDm: true,
    isGroup: false,
    attachments: [],
    ...overrides,
  };
}

describe('classifyTelegramText (FU-2)', () => {
  test('plain text → message kind', () => {
    expect(classifyTelegramText('hello world')).toEqual({ kind: 'message' });
  });
  test('/cmd → command kind with empty body', () => {
    expect(classifyTelegramText('/summary')).toEqual({
      kind: 'command',
      command: 'summary',
      body: '',
    });
  });
  test('/cmd rest → command + body', () => {
    expect(classifyTelegramText('/summary today please')).toEqual({
      kind: 'command',
      command: 'summary',
      body: 'today please',
    });
  });
  test('/cmd@bot strips bot mention', () => {
    expect(classifyTelegramText('/start@MonadBot')).toEqual({
      kind: 'command',
      command: 'start',
      body: '',
    });
  });
  test('// or weird prefix → message kind', () => {
    expect(classifyTelegramText('hello /not-a-cmd')).toEqual({ kind: 'message' });
  });
});

describe('TelegramBot onTriggerTap (FU-2)', () => {
  test('fires for allowed message + normalizes to kind=message', async () => {
    const taps: TgTriggerEvent[] = [];
    const bot = new TelegramBot({
      token: 'tok',
      allowedUsers: [200],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
      errorBackoffMs: 0,
    });

    await (bot as unknown as {
      handleIncoming: (ctx: TgIncoming) => Promise<void>;
    }).handleIncoming(fakeIncoming('hello'));
    await new Promise((r) => setTimeout(r, 5));

    expect(taps).toHaveLength(1);
    expect(taps[0]).toEqual({
      kind: 'message',
      chat: '100',
      user: '200',
      body: 'hello',
      messageId: 9,
      isDm: true,
    });
  });

  test('fires with kind=command for slash messages', async () => {
    const taps: TgTriggerEvent[] = [];
    const bot = new TelegramBot({
      token: 'tok',
      allowedUsers: [200],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
      errorBackoffMs: 0,
    });

    await (bot as unknown as {
      handleIncoming: (ctx: TgIncoming) => Promise<void>;
    }).handleIncoming(fakeIncoming('/summary today'));
    await new Promise((r) => setTimeout(r, 5));

    expect(taps[0]).toMatchObject({
      kind: 'command',
      command: 'summary',
      body: 'today',
    });
  });

  test('does NOT fire when user is outside the allowlist', async () => {
    const taps: TgTriggerEvent[] = [];
    const bot = new TelegramBot({
      token: 'tok',
      allowedUsers: [999],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
      errorBackoffMs: 0,
    });

    await (bot as unknown as {
      handleIncoming: (ctx: TgIncoming) => Promise<void>;
    }).handleIncoming(fakeIncoming('hi', { userId: 12345 }));
    await new Promise((r) => setTimeout(r, 5));

    expect(taps).toHaveLength(0);
  });

  test('swallows tap errors so chat reply still flows', async () => {
    let onMessageCalled = false;
    const bot = new TelegramBot({
      token: 'tok',
      allowedUsers: [200],
      onMessage: async () => { onMessageCalled = true; return undefined; },
      onTriggerTap: () => { throw new Error('tap exploded'); },
      fetchImpl: makeStubFetch() as never,
      errorBackoffMs: 0,
    });

    await (bot as unknown as {
      handleIncoming: (ctx: TgIncoming) => Promise<void>;
    }).handleIncoming(fakeIncoming('hi'));
    await new Promise((r) => setTimeout(r, 5));

    expect(onMessageCalled).toBe(true);
  });
});
