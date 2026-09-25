// T5.B — NEXUS HTTP voice transcribe + cost route surface (regression
// guard so the daemon-public freeze can't accidentally drop the path
// without NEXUS picking it up first).

import { describe, expect, test } from 'bun:test';

import { handleVoiceCost, handleVoiceTranscribe } from '../src/nexus/api/meta-api.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';
import type { VoiceRestHandler } from '../src/voice/voice-rest-handler.js';

function fakeVoiceRest(): VoiceRestHandler {
  return {
    handleTranscribe: async () =>
      new Response(JSON.stringify({ transcript: 'hi' }), { status: 200 }),
    handleCost: () => new Response(JSON.stringify({ usd: 0.42 }), { status: 200 }),
  } as unknown as VoiceRestHandler;
}

function makeOpts(extra: Partial<MetaApiOpts> = {}): MetaApiOpts {
  return {
    voiceRest: fakeVoiceRest(),
    noAuth: true,
    ...extra,
  } as MetaApiOpts;
}

describe('T5.B · NEXUS voice transcribe + cost', () => {
  test('handleVoiceTranscribe returns 200 + transcript when voiceRest wired', async () => {
    const req = new Request('http://x/v1/voice/transcribe', { method: 'POST', body: '{}' });
    const res = await handleVoiceTranscribe(req, makeOpts());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transcript: string };
    expect(body.transcript).toBe('hi');
  });

  test('handleVoiceCost returns 200 + usd', async () => {
    const req = new Request('http://x/v1/voice/cost');
    const res = await handleVoiceCost(req, makeOpts());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usd: number };
    expect(body.usd).toBe(0.42);
  });

  test('voiceRest absent → 503 voice-rest-disabled', async () => {
    const opts = { noAuth: true } as MetaApiOpts;
    const reqT = new Request('http://x/v1/voice/transcribe', { method: 'POST' });
    const r1 = await handleVoiceTranscribe(reqT, opts);
    expect(r1.status).toBe(503);

    const reqC = new Request('http://x/v1/voice/cost');
    const r2 = await handleVoiceCost(reqC, opts);
    expect(r2.status).toBe(503);
  });

  test('bearerToken set + missing auth → 401', async () => {
    const opts = makeOpts({ bearerToken: 'tok', noAuth: false });
    const req = new Request('http://x/v1/voice/cost');
    const res = await handleVoiceCost(req, opts);
    expect(res.status).toBe(401);
  });
});
