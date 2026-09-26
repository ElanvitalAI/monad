// Test: src/discord/webhook-pool.ts
//
// Coverage: webhook lifecycle (create · cache · cap · rehydrate ·
// retire) using a fake DiscordRestForWebhooks. No real fetch.
//
// CLAUDE.md: real wiring (no mock.module · no spyOn) — we inject a
// fake REST surface via the public constructor.

import { describe, expect, test } from 'bun:test';
import {
  DISCORD_WEBHOOKS_PER_CHANNEL_CAP,
  WebhookPool,
  webhookExecuteUrl,
  webhookNameForPersona,
  personaIdFromWebhookName,
  type DiscordRestForWebhooks,
  type DiscordWebhookRecord,
} from '../../src/discord/webhook-pool.js';

function makeFakeRest(): {
  rest: DiscordRestForWebhooks;
  state: {
    created: { channelId: string; name: string; id: string }[];
    deleted: string[];
    listResponses: Map<string, DiscordWebhookRecord[]>;
  };
} {
  let nextId = 1;
  const created: { channelId: string; name: string; id: string }[] = [];
  const deleted: string[] = [];
  const listResponses = new Map<string, DiscordWebhookRecord[]>();
  const rest: DiscordRestForWebhooks = {
    async createWebhook(channelId, name) {
      const id = `wh-${nextId++}`;
      const record: DiscordWebhookRecord = {
        id, token: `tok-${id}`, name, channelId,
      };
      created.push({ channelId, name, id });
      return record;
    },
    async listChannelWebhooks(channelId) {
      return listResponses.get(channelId) ?? [];
    },
    async deleteWebhook(webhookId) {
      deleted.push(webhookId);
    },
  };
  return { rest, state: { created, deleted, listResponses } };
}

describe('webhookNameForPersona / personaIdFromWebhookName roundtrip', () => {
  test('encodes persona id with prefix', () => {
    expect(webhookNameForPersona('sage')).toBe('elanous-persona:sage');
  });
  test('extracts persona id from matching name', () => {
    expect(personaIdFromWebhookName('elanous-persona:sage')).toBe('sage');
  });
  test('returns null for non-matching name', () => {
    expect(personaIdFromWebhookName('Other Bot')).toBeNull();
    expect(personaIdFromWebhookName('')).toBeNull();
  });
});

describe('webhookExecuteUrl', () => {
  test('builds the v10 execute path with id + token', () => {
    const url = webhookExecuteUrl({
      id: 'wh-7', token: 'tok-7', name: 'elanous-persona:sage', channelId: 'ch-1',
    });
    expect(url).toBe('https://discord.com/api/v10/webhooks/wh-7/tok-7');
  });
});

describe('WebhookPool.ensure', () => {
  test('creates a webhook on first call · caches on second', async () => {
    const { rest, state } = makeFakeRest();
    const pool = new WebhookPool(rest);
    const r1 = await pool.ensure('ch-1', 'sage');
    expect(r1.name).toBe('elanous-persona:sage');
    expect(state.created).toHaveLength(1);

    const r2 = await pool.ensure('ch-1', 'sage');
    expect(r2.id).toBe(r1.id);          // same instance from cache
    expect(state.created).toHaveLength(1); // no second create
  });

  test('different personas in same channel get different webhooks', async () => {
    const { rest, state } = makeFakeRest();
    const pool = new WebhookPool(rest);
    const sage = await pool.ensure('ch-1', 'sage');
    const con = await pool.ensure('ch-1', 'contrarian');
    expect(sage.id).not.toBe(con.id);
    expect(state.created).toHaveLength(2);
  });

  test('refuses to exceed Discord per-channel cap (15)', async () => {
    const { rest, state } = makeFakeRest();
    state.listResponses.set('ch-1', Array.from(
      { length: DISCORD_WEBHOOKS_PER_CHANNEL_CAP },
      (_, i) => ({
        id: `pre-${i}`, token: `pt-${i}`,
        // intentionally non-persona names so they're "known" but not adopted
        name: `Other Bot ${i}`, channelId: 'ch-1',
      }),
    ));
    const pool = new WebhookPool(rest);
    await pool.rehydrate('ch-1');  // count = 15, no adopts

    await expect(pool.ensure('ch-1', 'sage')).rejects.toThrow(/at cap 15/);
    expect(state.created).toHaveLength(0);
  });
});

describe('WebhookPool.rehydrate', () => {
  test('adopts existing webhooks matching the convention', async () => {
    const { rest, state } = makeFakeRest();
    state.listResponses.set('ch-1', [
      { id: 'wh-99', token: 'tok-99', name: 'elanous-persona:sage', channelId: 'ch-1' },
      { id: 'wh-100', token: 'tok-100', name: 'Other Bot', channelId: 'ch-1' },
    ]);
    const pool = new WebhookPool(rest);
    await pool.rehydrate('ch-1');

    expect(pool.getCached('ch-1', 'sage')?.id).toBe('wh-99');
    expect(pool.getCached('ch-1', 'unknown')).toBeUndefined();

    // Subsequent ensure returns the adopted record (no create).
    const r = await pool.ensure('ch-1', 'sage');
    expect(r.id).toBe('wh-99');
    expect(state.created).toHaveLength(0);
  });
});

describe('WebhookPool.retire', () => {
  test('deletes the webhook · removes from cache · is idempotent', async () => {
    const { rest, state } = makeFakeRest();
    const pool = new WebhookPool(rest);
    const r = await pool.ensure('ch-1', 'sage');
    expect(pool.getCached('ch-1', 'sage')).toBeDefined();

    await pool.retire('ch-1', 'sage');
    expect(state.deleted).toContain(r.id);
    expect(pool.getCached('ch-1', 'sage')).toBeUndefined();

    // Second retire = no-op (best-effort).
    await pool.retire('ch-1', 'sage');
    expect(state.deleted).toHaveLength(1);
  });

  test('swallows REST errors during delete', async () => {
    const fakeRest: DiscordRestForWebhooks = {
      async createWebhook(channelId, name) {
        return { id: 'wh-1', token: 't', name, channelId };
      },
      async listChannelWebhooks() { return []; },
      async deleteWebhook() { throw new Error('Discord 404'); },
    };
    const pool = new WebhookPool(fakeRest);
    await pool.ensure('ch-1', 'sage');
    // Should not throw.
    await pool.retire('ch-1', 'sage');
    expect(pool.getCached('ch-1', 'sage')).toBeUndefined();
  });
});

describe('WebhookPool.executeUrl', () => {
  test('returns null for uncached (channel, persona)', () => {
    const { rest } = makeFakeRest();
    const pool = new WebhookPool(rest);
    expect(pool.executeUrl('ch-1', 'sage')).toBeNull();
  });
  test('returns the execute URL after ensure', async () => {
    const { rest } = makeFakeRest();
    const pool = new WebhookPool(rest);
    const r = await pool.ensure('ch-1', 'sage');
    expect(pool.executeUrl('ch-1', 'sage')).toBe(
      `https://discord.com/api/v10/webhooks/${r.id}/${r.token}`,
    );
  });
});
