// M2-2b-v2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// ElevenLabs voice library proxy.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  __resetElevenLabsCacheForTests,
  getVoiceLibrary,
  handleElevenLabsVoicesGet,
} from '../../src/nexus/api/elevenlabs-voices.js';

const PREV_KEY = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  __resetElevenLabsCacheForTests();
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(() => {
  if (PREV_KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = PREV_KEY;
  __resetElevenLabsCacheForTests();
});

function fakeFetch(payload: { status?: number; body?: unknown } | Error): typeof fetch {
  return (async () => {
    if (payload instanceof Error) throw payload;
    const status = payload.status ?? 200;
    return new Response(JSON.stringify(payload.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const SAMPLE_VOICES = [
  {
    voice_id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    category: 'premade',
    labels: { accent: 'American', gender: 'female', age: 'young', description: 'calm narration' },
    preview_url: 'https://cdn.example.com/rachel.mp3',
  },
  {
    voice_id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    category: 'premade',
    labels: { accent: 'American', gender: 'male', age: 'middle aged', description: 'deep narration' },
    preview_url: 'https://cdn.example.com/adam.mp3',
  },
  {
    voice_id: 'no_name_voice', // missing name → skipped
    category: 'premade',
  },
];

describe('M2-2b-v2 · getVoiceLibrary', () => {
  test('no API key → empty + configured:false · no fetch attempted', async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response('', { status: 200 }); }) as unknown as typeof fetch;
    const r = await getVoiceLibrary({ fetchImpl });
    expect(r.voices).toEqual([]);
    expect(r.configured).toBe(false);
    expect(called).toBe(false);
  });

  test('with API key + ok response · returns mapped voices', async () => {
    process.env.ELEVENLABS_API_KEY = 'tk-test';
    const r = await getVoiceLibrary({
      fetchImpl: fakeFetch({ body: { voices: SAMPLE_VOICES } }),
    });
    expect(r.configured).toBe(true);
    expect(r.voices).toHaveLength(2); // 3rd dropped (no name)
    const rachel = r.voices.find((v) => v.id === '21m00Tcm4TlvDq8ikWAM');
    expect(rachel).toBeDefined();
    expect(rachel?.name).toBe('Rachel');
    expect(rachel?.category).toBe('premade');
    expect(rachel?.accent).toBe('American');
    expect(rachel?.gender).toBe('female');
    expect(rachel?.previewUrl).toBe('https://cdn.example.com/rachel.mp3');
  });

  test('drops voices missing id or name (defensive)', async () => {
    process.env.ELEVENLABS_API_KEY = 'tk';
    const r = await getVoiceLibrary({
      fetchImpl: fakeFetch({ body: { voices: [{ name: 'NoId' }, { voice_id: 'no-name' }, ...SAMPLE_VOICES] } }),
    });
    expect(r.voices.map((v) => v.id).sort()).toEqual(
      ['21m00Tcm4TlvDq8ikWAM', 'pNInz6obpgDQGcFmaJgB'].sort(),
    );
  });

  test('caches results · second call hits cache', async () => {
    process.env.ELEVENLABS_API_KEY = 'tk';
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ voices: SAMPLE_VOICES }), { status: 200 });
    }) as unknown as typeof fetch;
    await getVoiceLibrary({ fetchImpl });
    const r2 = await getVoiceLibrary({ fetchImpl });
    expect(calls).toBe(1);
    expect(r2.fromCache).toBe(true);
  });

  test('5xx response → empty list cached (no retry storm)', async () => {
    process.env.ELEVENLABS_API_KEY = 'tk';
    const r = await getVoiceLibrary({
      fetchImpl: fakeFetch({ status: 500, body: { error: 'boom' } }),
    });
    expect(r.voices).toEqual([]);
    expect(r.configured).toBe(true);
  });

  test('fetch throws → empty (no retry storm) but keeps configured:true', async () => {
    process.env.ELEVENLABS_API_KEY = 'tk';
    const r = await getVoiceLibrary({
      fetchImpl: fakeFetch(new TypeError('offline')),
    });
    expect(r.voices).toEqual([]);
    expect(r.configured).toBe(true);
  });

  test('API key change invalidates cache', async () => {
    process.env.ELEVENLABS_API_KEY = 'old-key';
    await getVoiceLibrary({ fetchImpl: fakeFetch({ body: { voices: SAMPLE_VOICES } }) });
    process.env.ELEVENLABS_API_KEY = 'new-key';
    let calls = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['xi-api-key']).toBe('new-key');
      return new Response(JSON.stringify({ voices: SAMPLE_VOICES }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await getVoiceLibrary({ fetchImpl });
    expect(calls).toBe(1);
    expect(r.fromCache).toBe(false);
  });

  test('handleElevenLabsVoicesGet returns 200 with shape { voices, configured, fromCache, cacheTtlMs }', async () => {
    const res = await handleElevenLabsVoicesGet();
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.voices).toEqual([]);
    expect(body.configured).toBe(false);
    expect(typeof body.cacheTtlMs).toBe('number');
  });
});
