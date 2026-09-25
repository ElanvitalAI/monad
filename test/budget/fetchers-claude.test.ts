// H6 P1 Bundle 1 · Claude fetcher tests.
//
// Exercises OAuth request shape + response mapping through the
// `fetchImpl` seam · credentials resolution against tmp files · and
// the 401 surface. Real network is never hit.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createClaudeFetcher,
  resolveClaudeAccessToken,
} from '../../src/budget/fetchers/claude';

function makeResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('claude fetcher · credentials resolution', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'claude-creds-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('returns env token when CLAUDE_CODE_OAUTH_TOKEN set', () => {
    const token = resolveClaudeAccessToken({
      env: { CLAUDE_CODE_OAUTH_TOKEN: '  sk-ant-oat-env ' } as NodeJS.ProcessEnv,
      credentialsPath: join(tmp, 'nope.json'),
    });
    expect(token).toBe('sk-ant-oat-env');
  });

  test('falls back to credentials file · claudeAiOauth shape', () => {
    const path = join(tmp, '.credentials.json');
    writeFileSync(
      path,
      JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-file' } }),
    );
    const token = resolveClaudeAccessToken({
      env: {} as NodeJS.ProcessEnv,
      credentialsPath: path,
    });
    expect(token).toBe('sk-ant-oat-file');
  });

  test('tolerates legacy flat access_token shape', () => {
    const path = join(tmp, '.credentials.json');
    writeFileSync(path, JSON.stringify({ access_token: 'legacy-tok' }));
    const token = resolveClaudeAccessToken({
      env: {} as NodeJS.ProcessEnv,
      credentialsPath: path,
    });
    expect(token).toBe('legacy-tok');
  });

  test('returns null when neither env nor file has a token', () => {
    const token = resolveClaudeAccessToken({
      env: {} as NodeJS.ProcessEnv,
      credentialsPath: join(tmp, 'missing.json'),
    });
    expect(token).toBeNull();
  });
});

describe('claude fetcher · response mapping', () => {
  test('maps five_hour + seven_day + model-specific windows', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = createClaudeFetcher({
      accessToken: 'sk-ant-oat-test',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return makeResponse({
          five_hour: { utilization: 8, resets_at: '2026-04-22T12:00:00Z' },
          seven_day: { utilization: 50, resets_at: '2026-04-29T00:00:00Z' },
          seven_day_sonnet: { utilization: 30, resets_at: '2026-04-29T00:00:00Z' },
          seven_day_opus: { utilization: 70, resets_at: '2026-04-29T00:00:00Z' },
        });
      }) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.provider).toBe('claude');
    expect(snap.source).toBe('oauth-api');
    expect(snap.windows.length).toBe(4);
    expect(snap.windows[0]?.kind).toBe('session');
    expect(snap.windows[0]?.used).toBe(8);
    expect(snap.windows[0]?.windowMinutes).toBe(300);
    expect(snap.windows.find((w) => w.model === 'opus')?.used).toBe(70);

    // Verify request shape
    expect(calls.length).toBe(1);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-ant-oat-test');
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  test('handles missing windows gracefully', async () => {
    const fetcher = createClaudeFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        makeResponse({ five_hour: { utilization: 5, resets_at: '2026-04-22T12:00:00Z' } })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.windows.length).toBe(1);
  });

  test('throws with status + body excerpt on non-2xx', async () => {
    const fetcher = createClaudeFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        new Response('invalid token', {
          status: 401,
          statusText: 'Unauthorized',
        })) as typeof fetch,
    });
    await expect(fetcher.fetch()).rejects.toThrow(/401.*Unauthorized/);
  });

  test('throws when no token available', async () => {
    // clean env + no file
    const tmp = mkdtempSync(join(tmpdir(), 'claude-no-tok-'));
    try {
      const fetcher = createClaudeFetcher({
        credentialsPath: join(tmp, 'missing.json'),
        env: {} as NodeJS.ProcessEnv,
        fetchImpl: (async () => makeResponse({})) as typeof fetch,
      });
      await expect(fetcher.fetch()).rejects.toThrow(/no Claude OAuth token/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('clamps utilization outside 0..100', async () => {
    const fetcher = createClaudeFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        makeResponse({
          five_hour: { utilization: -5, resets_at: '2026-04-22T12:00:00Z' },
          seven_day: { utilization: 150, resets_at: '2026-04-29T00:00:00Z' },
        })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.windows[0]?.used).toBe(0);
    expect(snap.windows[1]?.used).toBe(100);
  });

  test('resets_at parses ISO-8601 to epoch ms', async () => {
    const fetcher = createClaudeFetcher({
      accessToken: 'tok',
      fetchImpl: (async () =>
        makeResponse({
          five_hour: { utilization: 0, resets_at: '2026-01-01T00:00:00Z' },
        })) as typeof fetch,
    });
    const snap = await fetcher.fetch();
    expect(snap.windows[0]?.resetsAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });
});
