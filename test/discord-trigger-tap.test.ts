// Surface-unification v2 FU-1 (2026-05-11) — Discord trigger tap.
//
// Verifies that the DiscordBot fires `onTriggerTap` for every allowed
// inbound message in parallel with the existing chat reply path. The
// NEXUS wire (separate PR) hooks this into `daemon.dispatchDiscord` so
// discordTrigger nodes fire from real Discord traffic.

import { describe, expect, test } from 'bun:test';
import { DiscordBot, type DcTriggerEvent } from '../src/discord';

function makeStubFetch(payload: unknown = { id: 'msg' }) {
  return async () => ({ ok: true, status: 200, json: async () => payload, text: async () => '' });
}

describe('DiscordBot onTriggerTap (FU-1)', () => {
  test('fires for allowed DM message with normalized event shape', async () => {
    const taps: DcTriggerEvent[] = [];
    const bot = new DiscordBot({
      token: 'tok',
      allowedUsers: ['user-1'],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
    });

    // Drive the private handler — gateway dispatch normalization is
    // independent infrastructure we don't need to re-test here.
    await (bot as unknown as {
      handleMessageCreate: (m: Record<string, unknown>) => Promise<void>;
    }).handleMessageCreate({
      author: { id: 'user-1', bot: false, username: 'alice' },
      channel_id: 'CH-9',
      content: 'hello bot',
      id: 'msg-1',
      // guild_id absent → isDm
    });

    // Promise.resolve(...).catch in the tap is fire-and-forget, so the
    // synchronous tap call lands before the await chain unrolls.
    await new Promise((r) => setTimeout(r, 5));

    expect(taps).toHaveLength(1);
    expect(taps[0]).toEqual({
      kind: 'message',
      channel: 'CH-9',
      user: 'user-1',
      body: 'hello bot',
      messageId: 'msg-1',
      isDm: true,
    });
  });

  test('does NOT fire when user is outside the allowlist', async () => {
    const taps: DcTriggerEvent[] = [];
    const bot = new DiscordBot({
      token: 'tok',
      allowedUsers: ['user-1'],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
    });

    await (bot as unknown as {
      handleMessageCreate: (m: Record<string, unknown>) => Promise<void>;
    }).handleMessageCreate({
      author: { id: 'stranger', bot: false, username: 'eve' },
      channel_id: 'CH',
      content: 'hi',
      id: 'msg',
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(taps).toHaveLength(0);
  });

  test('does NOT fire when bot is the author (self-message)', async () => {
    const taps: DcTriggerEvent[] = [];
    const bot = new DiscordBot({
      token: 'tok',
      allowedUsers: [],
      onMessage: async () => undefined,
      onTriggerTap: (ev) => { taps.push(ev); },
      fetchImpl: makeStubFetch() as never,
    });

    await (bot as unknown as {
      handleMessageCreate: (m: Record<string, unknown>) => Promise<void>;
    }).handleMessageCreate({
      author: { id: 'self', bot: true, username: 'elanous' },
      channel_id: 'CH',
      content: 'echo',
      id: 'msg',
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(taps).toHaveLength(0);
  });

  test('swallows tap errors so chat reply still flows', async () => {
    let onMessageCalled = false;
    const bot = new DiscordBot({
      token: 'tok',
      allowedUsers: ['user-1'],
      onMessage: async () => { onMessageCalled = true; return undefined; },
      onTriggerTap: () => { throw new Error('tap exploded'); },
      fetchImpl: makeStubFetch() as never,
    });

    await (bot as unknown as {
      handleMessageCreate: (m: Record<string, unknown>) => Promise<void>;
    }).handleMessageCreate({
      author: { id: 'user-1', bot: false, username: 'alice' },
      channel_id: 'CH',
      content: 'hi',
      id: 'msg',
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(onMessageCalled).toBe(true);
  });
});
