// Phase D · multi-device push dispatcher — fanout + isolation per sink.

import { describe, expect, test } from 'bun:test';
import {
  createCapturePushDispatcher,
  createDiscordWebhookSink,
  createPushcutCaptureSink,
  createTelegramCaptureSink,
  type CapturePushPayload,
  type CapturePushSink,
} from '../src/capture/capture-push.js';

const samplePayload: CapturePushPayload = {
  bodyBase64: 'PNG-bytes',
  mimeType: 'image/png',
  caption: 'capture: vw:1/build (observe-only)',
  surfaceLabel: 'vw:1/build',
  capturedAt: 1700000000000,
};

describe('CapturePushDispatcher', () => {
  test('register / list / unregister', () => {
    const d = createCapturePushDispatcher();
    expect(d.size()).toBe(0);

    const sink: CapturePushSink = {
      kind: 'telegram',
      id: '42',
      send: async () => {},
    };
    d.register(sink);
    expect(d.size()).toBe(1);
    expect(d.list()[0]!.id).toBe('42');

    expect(d.unregister('telegram', '42')).toBe(true);
    expect(d.size()).toBe(0);
    expect(d.unregister('telegram', '42')).toBe(false);
  });

  test('register is idempotent on (kind, id)', () => {
    const d = createCapturePushDispatcher();
    const a: CapturePushSink = { kind: 'telegram', id: '1', send: async () => {} };
    const b: CapturePushSink = { kind: 'telegram', id: '1', send: async () => {} };
    d.register(a);
    d.register(b);
    expect(d.size()).toBe(1);
  });

  test('push with no targets — empty outcomes', async () => {
    const d = createCapturePushDispatcher();
    const outcomes = await d.push(samplePayload);
    expect(outcomes).toHaveLength(0);
  });

  test('push fans out to all sinks — successful sends', async () => {
    const d = createCapturePushDispatcher();
    let nowCounter = 1000;
    const dWithClock = createCapturePushDispatcher({ now: () => (nowCounter += 5) });

    const calls: string[] = [];
    dWithClock.register({
      kind: 'telegram', id: '1',
      send: async () => { calls.push('telegram-1'); },
    });
    dWithClock.register({
      kind: 'discord', id: 'wh-1',
      send: async () => { calls.push('discord-wh-1'); },
    });

    const outcomes = await dWithClock.push(samplePayload);
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.status === 'sent')).toBe(true);
    expect(calls.sort()).toEqual(['discord-wh-1', 'telegram-1']);
    // elapsedMs is non-negative (clock advances per access)
    expect(outcomes.every((o) => o.elapsedMs >= 0)).toBe(true);
  });

  test('per-sink failure is isolated — others still send', async () => {
    const d = createCapturePushDispatcher();
    d.register({
      kind: 'telegram', id: '1',
      send: async () => { throw new Error('rate-limit'); },
    });
    let discordSent = false;
    d.register({
      kind: 'discord', id: 'wh-1',
      send: async () => { discordSent = true; },
    });

    const outcomes = await d.push(samplePayload);
    expect(outcomes).toHaveLength(2);
    const tg = outcomes.find((o) => o.kind === 'telegram')!;
    const dc = outcomes.find((o) => o.kind === 'discord')!;
    expect(tg.status).toBe('failed');
    expect(tg.error).toContain('rate-limit');
    expect(dc.status).toBe('sent');
    expect(discordSent).toBe(true);
  });

  test('filter narrows targets', async () => {
    const d = createCapturePushDispatcher();
    d.register({ kind: 'telegram', id: '1', send: async () => {} });
    d.register({ kind: 'discord', id: 'wh-1', send: async () => {} });

    const outcomes = await d.push(samplePayload, {
      filter: (sink) => sink.kind === 'telegram',
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.kind).toBe('telegram');
  });
});

describe('createTelegramCaptureSink', () => {
  test('forwards to host-injected sendPhoto with chatId', async () => {
    const calls: Array<{ chatId: number; payload: CapturePushPayload }> = [];
    const sink = createTelegramCaptureSink({
      chatId: 7,
      sendPhoto: async (chatId, payload) => { calls.push({ chatId, payload }); },
    });
    expect(sink.kind).toBe('telegram');
    expect(sink.id).toBe('7');

    await sink.send(samplePayload);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.chatId).toBe(7);
    expect(calls[0]!.payload.bodyBase64).toBe('PNG-bytes');
  });
});

describe('createDiscordWebhookSink', () => {
  test('extracts webhook id from URL for stable routing', () => {
    const sink = createDiscordWebhookSink({
      webhookUrl: 'https://discord.com/api/webhooks/123456/secret-token',
      fetchImpl: fetch,
    });
    expect(sink.kind).toBe('discord');
    expect(sink.id).toBe('123456');
  });

  test('POSTs multipart form to webhook URL', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = async (input: any, init?: any) => {
      calls.push({ url: String(input), init });
      return new Response('', { status: 204 });
    };
    const sink = createDiscordWebhookSink({
      webhookUrl: 'https://discord.com/api/webhooks/77/token',
      fetchImpl: fakeFetch as typeof fetch,
    });
    await sink.send(samplePayload);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/webhooks/77/');
    expect(calls[0]!.init?.method).toBe('POST');
  });

  test('non-ok response throws', async () => {
    const fakeFetch = async () => new Response('rate-limited', { status: 429 });
    const sink = createDiscordWebhookSink({
      webhookUrl: 'https://discord.com/api/webhooks/1/x',
      fetchImpl: fakeFetch as typeof fetch,
    });
    await expect(sink.send(samplePayload)).rejects.toThrow(/discord webhook 429/);
  });
});

describe('createPushcutCaptureSink', () => {
  test('POSTs JSON body with image data URL', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fakeFetch = async (input: any, init?: any) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response('', { status: 200 });
    };
    const sink = createPushcutCaptureSink({
      pushcutUrl: 'https://api.pushcut.io/abc/notifications/MonadCapture',
      fetchImpl: fakeFetch as typeof fetch,
      deviceLabel: 'ipad-11',
    });
    expect(sink.id).toBe('ipad-11');

    await sink.send(samplePayload);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.image).toContain('data:image/png;base64,');
    expect(calls[0]!.body.image).toContain('PNG-bytes');
  });

  test('non-ok response throws', async () => {
    const fakeFetch = async () => new Response('', { status: 500 });
    const sink = createPushcutCaptureSink({
      pushcutUrl: 'https://api.pushcut.io/x/notifications/Y',
      fetchImpl: fakeFetch as typeof fetch,
    });
    await expect(sink.send(samplePayload)).rejects.toThrow(/pushcut 500/);
  });
});
