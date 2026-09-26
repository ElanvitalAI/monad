// RFC #2161 Phase 5 — verify GET /v1/registry/resolved + PUT disable
// endpoint shape.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleRegistryResolved,
  handleRegistryProviderDisable,
  type ResolvedViewResponse,
} from '../src/nexus/api/registry-resolved.js';
import { __resetLiveStoreForTests } from '../src/registry/live-store.js';

let tmpHome: string;
const ALL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'];

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'rrv-'));
  process.env.ELANOUS_TEST_HOME = tmpHome;
  for (const k of ALL_KEYS) delete process.env[k];
  __resetLiveStoreForTests();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.ELANOUS_TEST_HOME;
  for (const k of ALL_KEYS) delete process.env[k];
});

describe('handleRegistryResolved (GET /v1/registry/resolved)', () => {
  test('returns 200 + resolved view shape', async () => {
    const res = handleRegistryResolved();
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResolvedViewResponse;
    expect(typeof body.catalogVersion).toBe('number');
    expect(Array.isArray(body.providers)).toBe(true);
    expect(typeof body.generatedAt).toBe('number');
  });

  test('every provider entry includes a live state block', async () => {
    const body = (await handleRegistryResolved().json()) as ResolvedViewResponse;
    for (const p of body.providers) {
      expect(typeof p.id).toBe('string');
      expect(p.live).not.toBeNull();
      expect(typeof p.live?.availability).toBe('string');
    }
  });

  test('reports no-api-key for cloud providers without env vars', async () => {
    const body = (await handleRegistryResolved().json()) as ResolvedViewResponse;
    const ant = body.providers.find((p) => p.id === 'anthropic');
    expect(ant?.live?.availability).toBe('no-api-key');
  });

  test('promotes to available once env appears', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    __resetLiveStoreForTests();
    const body = (await handleRegistryResolved().json()) as ResolvedViewResponse;
    const ant = body.providers.find((p) => p.id === 'anthropic');
    expect(ant?.live?.availability).toBe('available');
  });
});

describe('handleRegistryProviderDisable (PUT /v1/registry/resolved/:id/disable)', () => {
  test('sets disabled=true → 200 + provider live state echoed', async () => {
    const res = await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/anthropic/disable', {
        method: 'PUT',
        body: JSON.stringify({ disabled: true }),
      }),
      'anthropic',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: { availability: string; manualDisabled: boolean } };
    expect(body.ok).toBe(true);
    expect(body.provider.availability).toBe('disabled');
    expect(body.provider.manualDisabled).toBe(true);
  });

  test('disabled=false → reverts to env-based availability', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    __resetLiveStoreForTests();
    await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/openai/disable', {
        method: 'PUT',
        body: JSON.stringify({ disabled: true }),
      }),
      'openai',
    );
    const res2 = await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/openai/disable', {
        method: 'PUT',
        body: JSON.stringify({ disabled: false }),
      }),
      'openai',
    );
    const body = (await res2.json()) as { provider: { availability: string } };
    expect(body.provider.availability).toBe('available');
  });

  test('unknown provider → 404', async () => {
    const res = await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/mistral/disable', {
        method: 'PUT',
        body: JSON.stringify({ disabled: true }),
      }),
      'mistral',
    );
    expect(res.status).toBe(404);
  });

  test('invalid body → 400', async () => {
    const res = await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/anthropic/disable', {
        method: 'PUT',
        body: JSON.stringify({ unrelated: true }),
      }),
      'anthropic',
    );
    expect(res.status).toBe(400);
  });

  test('non-JSON body → 400', async () => {
    const res = await handleRegistryProviderDisable(
      new Request('http://x/v1/registry/resolved/anthropic/disable', {
        method: 'PUT',
        body: 'not json',
      }),
      'anthropic',
    );
    expect(res.status).toBe(400);
  });
});
