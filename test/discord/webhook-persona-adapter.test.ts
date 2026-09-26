// Test: src/discord/webhook-persona-adapter.ts
//
// Coverage: sendAsPersona body construction · username/avatar
// override · thread_id query param · wait=true behavior · error
// surfacing. Uses real WebhookPool with a fake REST + a fake fetch
// for execute calls (real wiring · no mock.module).

import { describe, expect, test } from 'bun:test';
import {
  appendThreadId,
  buildExecuteBody,
  WebhookPersonaAdapter,
  withWaitTrue,
  type PersonaIdentity,
} from '../../src/discord/webhook-persona-adapter.js';
import {
  WebhookPool,
  type DiscordRestForWebhooks,
  type DiscordWebhookRecord,
} from '../../src/discord/webhook-pool.js';

const SAGE: PersonaIdentity = {
  personaId: 'sage',
  displayName: 'Sage',
  avatarUrl: 'https://cdn.example/sage.png',
  brandColor: '#6d28d9',
};

const PRAGMA: PersonaIdentity = {
  personaId: 'pragmatist',
  displayName: 'Pragmatist',
  // no avatarUrl
};

function makeFakeRest(): DiscordRestForWebhooks {
  let n = 0;
  return {
    async createWebhook(channelId, name) {
      n++;
      const r: DiscordWebhookRecord = { id: `wh-${n}`, token: `tok-${n}`, name, channelId };
      return r;
    },
    async listChannelWebhooks() { return []; },
    async deleteWebhook() {},
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

function makeFakeFetch(responseBody: unknown = { id: 'msg-100' }, status = 200): {
  fetchImpl: typeof fetch;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = (async (input: any, init: any) => {
    captured.push({
      url: typeof input === 'string' ? input : (input as Request).url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(
      typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { fetchImpl, captured };
}

describe('buildExecuteBody', () => {
  test('emits content + username from displayName', () => {
    const body = buildExecuteBody(SAGE, '신중하게 보면', {});
    expect(body['content']).toBe('신중하게 보면');
    expect(body['username']).toBe('Sage');
    expect(body['avatar_url']).toBe('https://cdn.example/sage.png');
  });

  test('omits avatar_url when persona has no avatarUrl', () => {
    const body = buildExecuteBody(PRAGMA, 'hi', {});
    expect(body['avatar_url']).toBeUndefined();
  });

  test('usernameOverride wins over persona.displayName', () => {
    const body = buildExecuteBody(SAGE, 'hi', { usernameOverride: 'Sage (Plan)' });
    expect(body['username']).toBe('Sage (Plan)');
  });
});

describe('appendThreadId / withWaitTrue', () => {
  test('appends thread_id to a clean URL', () => {
    expect(appendThreadId('https://x.test/a', 't-1')).toBe('https://x.test/a?thread_id=t-1');
  });
  test('uses & when URL already has a query', () => {
    expect(appendThreadId('https://x.test/a?x=1', 't-1')).toBe('https://x.test/a?x=1&thread_id=t-1');
  });
  test('encodes thread_id', () => {
    expect(appendThreadId('https://x.test/a', 't 1')).toBe('https://x.test/a?thread_id=t%201');
  });
  test('withWaitTrue is idempotent', () => {
    expect(withWaitTrue('https://x.test/a')).toBe('https://x.test/a?wait=true');
    expect(withWaitTrue('https://x.test/a?wait=true')).toBe('https://x.test/a?wait=true');
  });
});

describe('WebhookPersonaAdapter.sendAsPersona', () => {
  test('creates webhook on first send · POSTs execute URL with username override', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    const r = await adapter.sendAsPersona('ch-1', SAGE, '신중하게 보면 두 가지 trade-off');
    expect(r.messageId).toBe('msg-100');
    expect(r.webhookId).toBe('wh-1');
    expect(captured).toHaveLength(1);

    const req = captured[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toMatch(/\/webhooks\/wh-1\/tok-1\?wait=true$/);
    const body = req.body as Record<string, unknown>;
    expect(body['content']).toBe('신중하게 보면 두 가지 trade-off');
    expect(body['username']).toBe('Sage');
    expect(body['avatar_url']).toBe('https://cdn.example/sage.png');
  });

  test('appends thread_id when provided', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, 'hi', { threadId: 'thread-42' });
    expect(captured[0]!.url).toMatch(/thread_id=thread-42/);
    expect(captured[0]!.url).toMatch(/wait=true/);
  });

  test('reuses cached webhook on second send (no extra create REST call)', async () => {
    const rest = makeFakeRest();
    let createCalls = 0;
    const wrapped: DiscordRestForWebhooks = {
      ...rest,
      async createWebhook(c, n) { createCalls++; return rest.createWebhook(c, n); },
    };
    const pool = new WebhookPool(wrapped);
    const { fetchImpl } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, 'first');
    await adapter.sendAsPersona('ch-1', SAGE, 'second');
    expect(createCalls).toBe(1);
  });

  test('different personas in same channel get different webhooks', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, 'a');
    await adapter.sendAsPersona('ch-1', PRAGMA, 'b');

    const url1 = captured[0]!.url;
    const url2 = captured[1]!.url;
    expect(url1).not.toBe(url2);
    expect((captured[0]!.body as any).username).toBe('Sage');
    expect((captured[1]!.body as any).username).toBe('Pragmatist');
  });

  test('throws on Discord error response with status attached', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl } = makeFakeFetch({ message: 'Bad Request' }, 400);
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await expect(adapter.sendAsPersona('ch-1', SAGE, 'hi')).rejects.toThrow(/discord webhook execute failed: 400/);
  });

  test('throws on empty content with no embed', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });
    await expect(adapter.sendAsPersona('ch-1', SAGE, '')).rejects.toThrow(/empty content and no embed/);
  });

  test('M1.2 — sends embed alongside content', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, '신중하게 분석', {
      embed: {
        description: '두 가지 trade-off 가 있습니다.',
        footerText: 'claude-opus-4-7 · $0.0142',
      },
    });
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body['content']).toBe('신중하게 분석');
    expect(body['embeds']).toBeDefined();
    const embeds = body['embeds'] as any[];
    expect(embeds).toHaveLength(1);
    expect(embeds[0].description).toBe('두 가지 trade-off 가 있습니다.');
    expect(embeds[0].color).toBe(0x6d28d9);  // sage brand color
    expect(embeds[0].footer.text).toBe('claude-opus-4-7 · $0.0142');
  });

  test('M1.2 — embed-only send (empty content with embed) is allowed', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, '', {
      embed: { description: 'embed-only message' },
    });
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body['content']).toBe('');
    expect((body['embeds'] as any[])[0].description).toBe('embed-only message');
  });

  test('M1.5 — components attach to the body', async () => {
    const { approveRejectButtons } = await import('../../src/discord/components-builder.js');
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl, captured } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    await adapter.sendAsPersona('ch-1', SAGE, '진행할까요?', {
      components: [approveRejectButtons({ gateId: 'g-7' })],
    });
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body['components']).toBeDefined();
    const rows = body['components'] as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(1);  // ACTION_ROW
    expect(rows[0].components).toHaveLength(2);
    expect(rows[0].components[0].custom_id).toBe('hitl:approve:g-7');
    expect(rows[0].components[1].custom_id).toBe('hitl:reject:g-7');
  });

  test('M1.5 — rejects more than 5 action rows', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });
    const fakeRow = { type: 1, components: [] };
    await expect(adapter.sendAsPersona('ch-1', SAGE, 'hi', {
      components: [fakeRow, fakeRow, fakeRow, fakeRow, fakeRow, fakeRow],
    })).rejects.toThrow(/at most 5 Action Rows/);
  });
});

describe('WebhookPersonaAdapter.cachedRecord', () => {
  test('returns null until ensured · then the record', async () => {
    const pool = new WebhookPool(makeFakeRest());
    const { fetchImpl } = makeFakeFetch();
    const adapter = new WebhookPersonaAdapter({ pool, fetchImpl });

    expect(adapter.cachedRecord('ch-1', 'sage')).toBeNull();
    await adapter.sendAsPersona('ch-1', SAGE, 'hi');
    const r = adapter.cachedRecord('ch-1', 'sage');
    expect(r?.id).toBe('wh-1');
    expect(r?.name).toBe('elanous-persona:sage');
  });
});
