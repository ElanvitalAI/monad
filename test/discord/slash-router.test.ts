// Test: src/discord/slash-router.ts + slash-types.ts

import { describe, expect, test } from 'bun:test';
import {
  normalizeInteractionPayload, SlashRouter,
} from '../../src/discord/slash-router.js';
import {
  buildResponseBody, RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCtxBase, type SlashInteraction,
} from '../../src/discord/slash-types.js';

const ECHO_CMD: BoundSlashCommand<{ tag: string }> = {
  schema: { name: 'echo', description: 'echo' },
  handler: async (i, ctx) => ({
    type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
    content: `[${ctx.tag}] ${i.options.get('msg') ?? ''}`,
  }),
};

const THROW_CMD: BoundSlashCommand<{ tag: string }> = {
  schema: { name: 'boom', description: 'throws' },
  handler: () => { throw new Error('boom'); },
};

function intr(over: Partial<SlashInteraction> = {}): SlashInteraction {
  return {
    id: 'i-1', token: 'tok', applicationId: 'app',
    commandName: 'echo',
    channelId: 'ch-1', userId: 'u-1',
    options: new Map<string, string | number | boolean>(),
    ...over,
  };
}

describe('SlashRouter.dispatch', () => {
  test('routes to bound handler with shared ctx', async () => {
    const r = new SlashRouter<SlashCtxBase & { tag: string }>({ tag: 'X' });
    r.bind(ECHO_CMD);
    const resp = await r.dispatch(intr({ options: new Map([['msg', 'hi']]) }));
    expect(resp.content).toBe('[X] hi');
  });

  test('unknown command → ephemeral error', async () => {
    const r = new SlashRouter<SlashCtxBase & { tag: string }>({ tag: 'X' });
    const resp = await r.dispatch(intr({ commandName: 'nope' }));
    expect(resp.content).toMatch(/unknown command/);
    expect(resp.ephemeral).toBe(true);
  });

  test('handler throw → ephemeral error', async () => {
    const r = new SlashRouter<SlashCtxBase & { tag: string }>({ tag: 'X' });
    r.bind(THROW_CMD);
    const resp = await r.dispatch(intr({ commandName: 'boom' }));
    expect(resp.content).toMatch(/handler error/);
    expect(resp.ephemeral).toBe(true);
  });

  test('schemas() returns registered schemas', () => {
    const r = new SlashRouter<SlashCtxBase & { tag: string }>({ tag: 'X' });
    r.bind(ECHO_CMD);
    r.bind(THROW_CMD);
    const names = r.schemas().map((s) => s.name).sort();
    expect(names).toEqual(['boom', 'echo']);
  });

  test('dispatchToBody returns Discord-shaped response', async () => {
    const r = new SlashRouter<SlashCtxBase & { tag: string }>({ tag: 'X' });
    r.bind(ECHO_CMD);
    const body = await r.dispatchToBody(intr({ options: new Map([['msg', 'hi']]) }));
    expect(body['type']).toBe(RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE);
    const data = body['data'] as Record<string, unknown>;
    expect(data['content']).toBe('[X] hi');
  });
});

describe('buildResponseBody', () => {
  test('content + ephemeral', () => {
    const b = buildResponseBody({
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: 'hi', ephemeral: true,
    });
    expect(b['type']).toBe(RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE);
    expect((b['data'] as any).content).toBe('hi');
    expect((b['data'] as any).flags).toBe(64);
  });
  test('omits empty embeds/components', () => {
    const b = buildResponseBody({
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: 'hi', embeds: [], components: [],
    });
    const data = b['data'] as Record<string, unknown>;
    expect(data['embeds']).toBeUndefined();
    expect(data['components']).toBeUndefined();
  });
  test('embeds + components propagate', () => {
    const b = buildResponseBody({
      type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
      content: '',
      embeds: [{ title: 'T' }],
      components: [{ type: 1, components: [] }],
    });
    const data = b['data'] as Record<string, unknown>;
    expect((data['embeds'] as any[])[0].title).toBe('T');
    expect((data['components'] as any[])[0].type).toBe(1);
  });
});

describe('normalizeInteractionPayload', () => {
  test('parses a CHAT_INPUT interaction', () => {
    const i = normalizeInteractionPayload({
      type: 2, id: 'i', token: 't', application_id: 'a',
      channel_id: 'ch', guild_id: 'g',
      member: { user: { id: 'u', username: 'jo' } },
      data: {
        name: 'echo', type: 1,
        options: [
          { name: 'msg', value: 'hi', type: 3 },
          { name: 'n', value: 7, type: 4 },
        ],
      },
    });
    expect(i).not.toBeNull();
    expect(i!.commandName).toBe('echo');
    expect(i!.userId).toBe('u');
    expect(i!.userName).toBe('jo');
    expect(i!.options.get('msg')).toBe('hi');
    expect(i!.options.get('n')).toBe(7);
    expect(i!.guildId).toBe('g');
  });

  test('returns null for non-slash type', () => {
    expect(normalizeInteractionPayload({ type: 3, data: {} })).toBeNull();
    expect(normalizeInteractionPayload({ type: 2, data: { name: 'x', type: 2 } })).toBeNull();
    expect(normalizeInteractionPayload(null)).toBeNull();
  });

  test('returns null when required ids missing', () => {
    const minimal = {
      type: 2, id: 'i', token: 't', application_id: 'a',
      channel_id: 'ch',
      data: { name: 'echo', type: 1 },
      // user missing
    };
    expect(normalizeInteractionPayload(minimal)).toBeNull();
  });
});
