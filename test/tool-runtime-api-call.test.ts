// ── ApiCall ToolRuntime tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { apiCallRuntime } from '../src/tool-runtime/api-call-runtime';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import { getToolRuntime, dispatchToolByName, _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import { addAllowed, removeAllowed, listAllowed, setAllowlistPathForTesting, setRateLimitsForTesting } from '../src/tool-hints/api-allowlist';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ApiCall ToolRuntime', () => {
  const originalFetch = globalThis.fetch;
  let tmpDir: string;

  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    tmpDir = mkdtempSync(join(tmpdir(), 'api-rt-'));
    setAllowlistPathForTesting(join(tmpDir, 'api-allow.json'));
    // Start each test with an empty allowlist.
    for (const e of listAllowed()) removeAllowed(e.host);
    setRateLimitsForTesting({ perHost: 9999, global: 9999 });
  });

  afterEach(() => {
    _resetToolRuntimeRegistryForTest();
    for (const e of listAllowed()) removeAllowed(e.host);
    setAllowlistPathForTesting(null);
    globalThis.fetch = originalFetch;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('registry registers the runtime under id "api_call"', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('api_call')).toBe(apiCallRuntime);
  });

  test('aliases ApiCall / http_call / fetch_json all resolve', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('ApiCall')).toBe(apiCallRuntime);
    expect(getToolRuntime('http_call')).toBe(apiCallRuntime);
    expect(getToolRuntime('fetch_json')).toBe(apiCallRuntime);
  });

  test('blocked when host not on allowlist (no fetch issued)', async () => {
    registerAllDefaultToolRuntimes();
    let fetchCalled = 0;
    globalThis.fetch = ((..._args: unknown[]) => {
      fetchCalled++;
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;

    const res = await dispatchToolByName(
      'ApiCall',
      { method: 'GET', url: 'https://evil.example.com/foo' },
      { surface: 'dashboard' },
    ) as { output: string; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.output).toContain('blocked');
    expect(fetchCalled).toBe(0);
  });

  test('allowed host delegates to real dispatcher (stubbed fetch)', async () => {
    registerAllDefaultToolRuntimes();
    addAllowed('api.example.com', { reason: 'test', sessionOnly: true });
    globalThis.fetch = (() => Promise.resolve(new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))) as typeof fetch;

    const res = await dispatchToolByName(
      'ApiCall',
      { method: 'GET', url: 'https://api.example.com/ping' },
      { surface: 'dashboard' },
    ) as { output: string; metadata: { status: number; host: string } };
    expect(res.metadata.status).toBe(200);
    expect(res.metadata.host).toBe('api.example.com');
  });

  test('ctx.signal aborts the fetch', async () => {
    registerAllDefaultToolRuntimes();
    addAllowed('api.example.com', { reason: 'test', sessionOnly: true });
    // fetch that only resolves when its signal aborts.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (!sig) return;
        sig.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    }) as typeof fetch;

    const ctrl = new AbortController();
    const p = dispatchToolByName(
      'ApiCall',
      { method: 'GET', url: 'https://api.example.com/slow' },
      { surface: 'dashboard', signal: ctrl.signal },
    );
    setTimeout(() => ctrl.abort(), 20);
    const res = await p as { output: string; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.output).toContain('api_call failed');
  }, 2000);

  test('already-aborted ctx.signal aborts before fetch fires', async () => {
    registerAllDefaultToolRuntimes();
    addAllowed('api.example.com', { reason: 'test', sessionOnly: true });
    let fetchCalled = 0;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      fetchCalled++;
      const sig = init?.signal;
      if (sig?.aborted) {
        const err = new Error('aborted');
        (err as Error & { name: string }).name = 'AbortError';
        return Promise.reject(err);
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;

    const ctrl = new AbortController();
    ctrl.abort();
    const res = await dispatchToolByName(
      'ApiCall',
      { method: 'GET', url: 'https://api.example.com/x' },
      { surface: 'dashboard', signal: ctrl.signal },
    ) as { isError?: boolean };
    // fetch is still called (internal controller state is what matters,
    // not whether we short-circuit) — but it immediately rejects.
    expect(fetchCalled).toBe(1);
    expect(res.isError).toBe(true);
  });
});
