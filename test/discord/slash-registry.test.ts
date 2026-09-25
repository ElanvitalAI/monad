// Test: src/discord/slash-registry.ts

import { describe, expect, test } from 'bun:test';
import {
  makeCommandRest, toApiBody,
} from '../../src/discord/slash-registry.js';
import {
  COMMAND_TYPE_CHAT_INPUT, OPT_BOOLEAN, OPT_STRING,
  type SlashCommandSchema,
} from '../../src/discord/slash-types.js';

describe('toApiBody', () => {
  test('minimum schema → body without options', () => {
    const b = toApiBody({ name: 'ping', description: 'p' });
    expect(b).toEqual({ name: 'ping', description: 'p', type: COMMAND_TYPE_CHAT_INPUT });
  });

  test('options propagated', () => {
    const s: SlashCommandSchema = {
      name: 'echo', description: 'e',
      options: [
        { name: 'msg', description: 'm', type: OPT_STRING, required: true },
        {
          name: 'loud', description: 'l', type: OPT_BOOLEAN,
        },
      ],
    };
    const b = toApiBody(s);
    expect((b['options'] as any[]).length).toBe(2);
    expect((b['options'] as any[])[0].required).toBe(true);
    expect((b['options'] as any[])[1].required).toBeUndefined();
  });

  test('choices, default_member_permissions, dm_permission propagate', () => {
    const s: SlashCommandSchema = {
      name: 'x', description: 'x',
      options: [{
        name: 'mode', description: 'm', type: OPT_STRING,
        choices: [{ name: 'a', value: 'a' }, { name: 'b', value: 'b' }],
      }],
      defaultMemberPermissions: '8',
      dmPermission: false,
    };
    const b = toApiBody(s);
    expect(((b['options'] as any[])[0].choices as any[]).length).toBe(2);
    expect(b['default_member_permissions']).toBe('8');
    expect(b['dm_permission']).toBe(false);
  });
});

describe('makeCommandRest', () => {
  function makeFakeFetch(responseBody: unknown, status = 200): {
    fetchImpl: typeof fetch;
    captured: { url: string; method: string; body: any }[];
  } {
    const captured: { url: string; method: string; body: any }[] = [];
    const fetchImpl: typeof fetch = (async (input: any, init: any) => {
      captured.push({
        url: typeof input === 'string' ? input : (input as Request).url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(
        responseBody === undefined ? '' : JSON.stringify(responseBody),
        { status, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    return { fetchImpl, captured };
  }

  test('bulkOverwriteGlobal sends PUT with body, returns parsed records', async () => {
    const { fetchImpl, captured } = makeFakeFetch([
      { id: 'c1', name: 'ping', description: 'p', type: 1 },
      { id: 'c2', name: 'echo', description: 'e', type: 1, guild_id: 'g' },
    ]);
    const rest = makeCommandRest({ token: 't', fetchImpl });
    const out = await rest.bulkOverwriteGlobal('app-1', [
      { name: 'ping', description: 'p' },
      { name: 'echo', description: 'e', options: [
        { name: 'msg', description: 'm', type: OPT_STRING, required: true },
      ] },
    ]);
    expect(captured[0]!.method).toBe('PUT');
    expect(captured[0]!.url).toBe('https://discord.com/api/v10/applications/app-1/commands');
    expect((captured[0]!.body as any[]).length).toBe(2);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('c1');
    expect(out[1]!.guildId).toBe('g');
  });

  test('bulkOverwriteGuild URL', async () => {
    const { fetchImpl, captured } = makeFakeFetch([]);
    const rest = makeCommandRest({ token: 't', fetchImpl });
    await rest.bulkOverwriteGuild('app-1', 'guild-1', []);
    expect(captured[0]!.url).toBe('https://discord.com/api/v10/applications/app-1/guilds/guild-1/commands');
  });

  test('listGlobal returns parsed', async () => {
    const { fetchImpl } = makeFakeFetch([
      { id: 'a', name: 'a', description: '', type: 1 },
    ]);
    const rest = makeCommandRest({ token: 't', fetchImpl });
    const list = await rest.listGlobal('app-1');
    expect(list[0]!.name).toBe('a');
  });

  test('deleteGuild builds DELETE URL', async () => {
    const { fetchImpl, captured } = makeFakeFetch(undefined, 204);
    const rest = makeCommandRest({ token: 't', fetchImpl });
    await rest.deleteGuild('app-1', 'guild-1', 'cmd-1');
    expect(captured[0]!.method).toBe('DELETE');
    expect(captured[0]!.url).toBe('https://discord.com/api/v10/applications/app-1/guilds/guild-1/commands/cmd-1');
  });

  test('error response throws with status', async () => {
    const { fetchImpl } = makeFakeFetch({ message: 'Bad' }, 400);
    const rest = makeCommandRest({ token: 't', fetchImpl });
    await expect(rest.listGlobal('app-1')).rejects.toThrow(/400/);
  });
});
