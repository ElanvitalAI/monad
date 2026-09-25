// H6 P1 Bundle 2 · Gemini fetcher tests.
//
// Credentials resolution + response mapping through the `fetchImpl`
// seam. Real network stays untouched.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeminiFetcher, readGeminiCreds } from '../../src/budget/fetchers/gemini';

function makeResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('gemini creds resolution', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gemini-creds-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('reads access_token + expiry_date from oauth_creds.json', () => {
    const path = join(tmp, 'oauth_creds.json');
    writeFileSync(
      path,
      JSON.stringify({ access_token: 'ya29-fake', expiry_date: 9_999_999_999_999 }),
    );
    const creds = readGeminiCreds({ credsPath: path });
    expect(creds?.accessToken).toBe('ya29-fake');
    expect(creds?.expiresAtMs).toBe(9_999_999_999_999);
  });

  test('returns null when file missing', () => {
    expect(readGeminiCreds({ credsPath: join(tmp, 'nope.json') })).toBeNull();
  });

  test('returns null when access_token absent', () => {
    const path = join(tmp, 'oauth_creds.json');
    writeFileSync(path, JSON.stringify({ refresh_token: 'r' }));
    expect(readGeminiCreds({ credsPath: path })).toBeNull();
  });
});

describe('gemini fetcher · mapping', () => {
  test('maps quotas array with per-model remaining', async () => {
    const fetcher = createGeminiFetcher({
      accessToken: 'ya29-fake',
      fetchImpl: (async () =>
        makeResponse({
          quotas: [
            { modelId: 'gemini-2.5-pro', remainingFraction: 0.58, resetTime: '2026-04-23T00:00:00Z' },
            { modelId: 'gemini-2.5-flash', remainingFraction: 0.92, resetTime: '2026-04-23T00:00:00Z' },
          ],
        })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.provider).toBe('gemini');
    expect(snap.source).toBe('oauth-api');
    expect(snap.windows.length).toBe(2);
    const pro = snap.windows.find((w) => w.model === 'pro');
    expect(pro?.used).toBeCloseTo(42, 1);
    expect(pro?.remainingPercent).toBeCloseTo(58, 1);
  });

  test('collapses duplicate per-model rows by picking lowest remaining (CodexBar rule)', async () => {
    const fetcher = createGeminiFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        makeResponse({
          quotas: [
            { modelId: 'gemini-2.5-pro', remainingFraction: 0.5, resetTime: '2026-04-23T00:00:00Z' },
            { modelId: 'gemini-2.5-pro-preview', remainingFraction: 0.2, resetTime: '2026-04-23T00:00:00Z' },
          ],
        })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    const pro = snap.windows.find((w) => w.model === 'pro');
    // Lowest remaining (20%) wins ⇒ usedPercent = 80
    expect(pro?.used).toBeCloseTo(80, 1);
  });

  test('throws with status + body on non-2xx', async () => {
    const fetcher = createGeminiFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        new Response('quota denied', { status: 403, statusText: 'Forbidden' })) as typeof fetch,
    });
    await expect(fetcher.fetch()).rejects.toThrow(/403/);
  });

  test('throws when creds missing and no accessToken passed', async () => {
    const fetcher = createGeminiFetcher({
      credsPath: '/tmp/nonexistent-gemini-creds-xyz.json',
      fetchImpl: (async () => makeResponse({})) as typeof fetch,
    });
    await expect(fetcher.fetch()).rejects.toThrow(/no Gemini OAuth credentials/);
  });

  test('throws with clear message when access token expired', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gemini-exp-'));
    try {
      mkdirSync(tmp, { recursive: true });
      const credsPath = join(tmp, 'oauth_creds.json');
      writeFileSync(
        credsPath,
        JSON.stringify({ access_token: 'old-token', expiry_date: 1_000 }),
      );
      const fetcher = createGeminiFetcher({
        credsPath,
        now: () => 2_000,
        fetchImpl: (async () => makeResponse({})) as typeof fetch,
      });
      await expect(fetcher.fetch()).rejects.toThrow(/expired/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('tolerates flat (non-array) response shape', async () => {
    const fetcher = createGeminiFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        makeResponse({
          modelId: 'gemini-2.5-pro',
          remainingFraction: 0.75,
          resetTime: '2026-04-23T00:00:00Z',
        })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.windows.length).toBe(1);
    expect(snap.windows[0]?.used).toBeCloseTo(25, 1);
  });
});
