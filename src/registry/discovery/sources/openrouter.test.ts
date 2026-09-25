// 대표 2026-09-23 — OpenRouter 발견 소스. ⛔ 픽스처는 «실물 응답의 모양»을 그대로 줄인 것이다
//   (2026-09-23 `curl https://openrouter.ai/api/v1/models` · moonshotai/kimi-k2.6 항목 원형).
import { afterEach, describe, expect, it } from 'bun:test';
import { openRouterModelToSpec, openrouterSource, OPENROUTER_MODELS_ENDPOINT } from './openrouter.js';

const KIMI = {
  id: 'moonshotai/kimi-k2.6',
  name: 'MoonshotAI: Kimi K2.6',
  created: 1776699402,
  context_length: 262144,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  pricing: { prompt: '0.00000095', completion: '0.000004', input_cache_read: '0.00000016' },
  top_provider: { context_length: 262144, max_completion_tokens: 235929 },
  supported_parameters: ['max_tokens', 'tools', 'tool_choice', 'reasoning', 'include_reasoning', 'structured_outputs'],
  expiration_date: null,
};

function fakeFetch(body: unknown, status = 200, seen?: { headers?: Record<string, string>; url?: string }): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (seen) { seen.url = String(url); seen.headers = (init?.headers ?? {}) as Record<string, string>; }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const savedKey = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
});

describe('openRouterModelToSpec — «잰 칸»만 채운다', () => {
  it('실물 원형(kimi-k2.6)을 ModelSpec 으로 옮긴다', () => {
    const s = openRouterModelToSpec(KIMI);
    expect(s).toMatchObject({
      id: 'moonshotai/kimi-k2.6', provider: 'openrouter', displayName: 'MoonshotAI: Kimi K2.6',
      family: 'moonshotai', contextSize: 262144, outputMaxTokens: 235929,
      pricing: { inputPerMTok: 0.95, outputPerMTok: 4, cachedInputPerMTok: 0.16 },
      toolCalling: 'native-openai', reasoning: 'high', vision: 'images', kind: 'chat',
      streamingProtocol: 'sse', deprecated: null,
    });
    expect(s.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.capabilities).toMatchObject({ thinkingControl: true, effortControl: false, structuredOutput: true });
  });

  it('⛔ `supported_parameters` 가 «없으면» 도구를 «모른다»로 둔다 — `none` 으로 접지 않는다', () => {
    const { supported_parameters: _drop, ...noParams } = KIMI;
    const s = openRouterModelToSpec(noParams);
    expect(s.toolCalling).toBeUndefined();
    expect(s.reasoning).toBeUndefined();
    expect(s.capabilities).toBeUndefined();
  });

  it('✅ 음성 대조 — 목록은 «있는데» tools 가 «없으면» 그때만 `none` 이다', () => {
    const s = openRouterModelToSpec({ ...KIMI, supported_parameters: ['max_tokens', 'temperature'] });
    expect(s.toolCalling).toBe('none');
    expect(s.reasoning).toBeNull();
  });

  it('⛔ 가격이 음수(가변 표시)면 가격을 «안» 넣는다 — 0 으로 접지 않는다', () => {
    const s = openRouterModelToSpec({ ...KIMI, pricing: { prompt: '-1', completion: '-1' } });
    expect(s.pricing).toBeUndefined();
  });

  it('만료일이 있으면 deprecated 로 옮긴다', () => {
    expect(openRouterModelToSpec({ ...KIMI, expiration_date: '2026-12-11' }).deprecated).toBe('2026-12-11');
  });

  it('`~` 부동 별칭도 family 는 벤더로 잡는다', () => {
    expect(openRouterModelToSpec({ ...KIMI, id: '~moonshotai/kimi-latest' }).family).toBe('moonshotai');
  });
});

describe('openrouterSource.run — 성공과 «못 읽었다»를 가른다', () => {
  it('정상 응답 — id 없는 항목은 버리고 나머지를 낸다', async () => {
    const r = await openrouterSource.run({ fetchImpl: fakeFetch({ data: [KIMI, { name: 'no id' }] }) });
    expect(r.ok).toBe(true);
    expect(r.models.map((m) => m.id)).toEqual(['moonshotai/kimi-k2.6']);
    expect(r.models[0]!.discoveryMeta).toMatchObject({ source: 'auto-openrouter-api', confidence: 'high', autoFilled: true });
  });

  it('⛔ 키가 «없어도» 돈다(공개 엔드포인트) — 그리고 Authorization 을 «안» 보낸다', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const seen: { headers?: Record<string, string>; url?: string } = {};
    const r = await openrouterSource.run({ fetchImpl: fakeFetch({ data: [KIMI] }, 200, seen) });
    expect(r.ok).toBe(true);
    expect(seen.url).toBe(OPENROUTER_MODELS_ENDPOINT);
    expect(seen.headers?.authorization).toBeUndefined();
  });

  it('키가 있으면 Bearer 로 붙인다', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    const seen: { headers?: Record<string, string> } = {};
    await openrouterSource.run({ fetchImpl: fakeFetch({ data: [KIMI] }, 200, seen) });
    expect(seen.headers?.authorization).toBe('Bearer sk-or-v1-test');
  });

  it('⛔ 봉투가 틀리면 「0개 성공」이 아니라 «실패»다', async () => {
    const r = await openrouterSource.run({ fetchImpl: fakeFetch({ models: [] }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/upstream-shape/);
  });

  it('HTTP 오류 · 인증 오류 · 네트워크 오류를 «이름으로» 가른다', async () => {
    expect((await openrouterSource.run({ fetchImpl: fakeFetch({}, 500) })).error).toBe('upstream-http-500');
    expect((await openrouterSource.run({ fetchImpl: fakeFetch({}, 401) })).error).toBe('upstream-auth-401');
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const n = await openrouterSource.run({ fetchImpl: boom });
    expect(n.ok).toBe(false);
    expect(n.error).toMatch(/upstream-network: ECONNRESET/);
  });
});
