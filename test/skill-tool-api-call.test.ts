import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { buildApiCallTool, dispatchApiCall } from '../src/skills/tools/api-call.js';
import {
  addAllowed,
  hostOf,
  isAllowed,
  removeAllowed,
  setAllowlistPathForTesting,
  setRateLimitsForTesting,
} from '../src/tool-hints/api-allowlist.js';

let tmp: string;

beforeEach(() => {
  tmp = joinPath(tmpdir(), `mh-api-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  setAllowlistPathForTesting(joinPath(tmp, 'api-allow.json'));
  setRateLimitsForTesting();  // restore defaults
});

afterEach(() => {
  setAllowlistPathForTesting(null);
  setRateLimitsForTesting();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('hostOf', () => {
  test('parses URLs and bare hostnames', () => {
    expect(hostOf('https://api.github.com/user')).toBe('api.github.com');
    expect(hostOf('github.com')).toBe('github.com');
    expect(hostOf('  EXAMPLE.com  ')).toBe('example.com');
    expect(hostOf('*')).toBe('*');
  });

  test('rejects junk input', () => {
    expect(hostOf('')).toBeNull();
    expect(hostOf('   ')).toBeNull();
  });
});

describe('allowlist CRUD', () => {
  test('starts empty (fail-closed)', () => {
    expect(isAllowed('https://github.com/x')).toBe(false);
  });

  test('addAllowed makes a host pass isAllowed', () => {
    addAllowed('https://api.github.com/path');
    expect(isAllowed('https://api.github.com/anywhere')).toBe(true);
  });

  test('wildcard "*" allows any host', () => {
    addAllowed('*');
    expect(isAllowed('https://random.example.com/x')).toBe(true);
  });

  test('sessionOnly entries are not persisted', () => {
    addAllowed('localhost', { sessionOnly: true });
    expect(isAllowed('http://localhost:3000/')).toBe(true);
    // Reload by resetting cache via setAllowlistPathForTesting → same path
    setAllowlistPathForTesting(joinPath(tmp, 'api-allow.json'));
    expect(isAllowed('http://localhost:3000/')).toBe(false);
  });

  test('removeAllowed deletes', () => {
    addAllowed('api.example.com');
    expect(removeAllowed('api.example.com')).toBe(true);
    expect(isAllowed('https://api.example.com/x')).toBe(false);
    expect(removeAllowed('api.example.com')).toBe(false);
  });
});

describe('rate limiter', () => {
  test('blocks after per-host limit reached', () => {
    setRateLimitsForTesting({ perHost: 2, global: 100 });
    addAllowed('a.example.com');
    expect(isAllowed('https://a.example.com/x')).toBe(true);
    // Direct rate-token consumption (api_call uses this internally).
    const { consumeRateToken } = require('../src/tool-hints/api-allowlist.js');
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(false);
  });

  test('per-host bucket is independent across hosts', () => {
    setRateLimitsForTesting({ perHost: 1, global: 100 });
    const { consumeRateToken } = require('../src/tool-hints/api-allowlist.js');
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://b.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(false);
    expect(consumeRateToken('https://b.example.com/x').ok).toBe(false);
  });

  test('global limit blocks regardless of host', () => {
    setRateLimitsForTesting({ perHost: 100, global: 2 });
    const { consumeRateToken } = require('../src/tool-hints/api-allowlist.js');
    expect(consumeRateToken('https://a.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://b.example.com/x').ok).toBe(true);
    expect(consumeRateToken('https://c.example.com/x').ok).toBe(false);
  });
});

describe('buildApiCallTool', () => {
  test('schema declares method+url required', () => {
    const spec = buildApiCallTool();
    expect(spec.name).toBe('ApiCall');
    expect(spec.parameters.required).toEqual(['method', 'url']);
  });
});

describe('dispatchApiCall — allowlist gate', () => {
  test('blocks when host not allowed', async () => {
    const r = await dispatchApiCall({ method: 'GET', url: 'https://disallowed.example.com/x' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('blocked');
    expect(r.output).toContain('disallowed.example.com');
    expect(r.metadata.status).toBe(0);
  });

  test('proceeds when host is allowlisted (uses real Bun.serve)', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(JSON.stringify({ ok: true, value: 42 }), { headers: { 'content-type': 'application/json' } }) });
    addAllowed(`localhost`);
    try {
      const r = await dispatchApiCall({ method: 'GET', url: `http://localhost:${server.port}/data` });
      expect(r.isError).toBeUndefined();
      expect(r.metadata.status).toBe(200);
      expect(r.output).toContain('"value": 42');
    } finally {
      server.stop(true);
    }
  });
});

describe('dispatchApiCall — rate-limit gate', () => {
  test('returns isError + reason when rate exhausted', async () => {
    setRateLimitsForTesting({ perHost: 0, global: 100 });
    addAllowed('a.example.com');
    const r = await dispatchApiCall({ method: 'GET', url: 'https://a.example.com/x' });
    expect(r.isError).toBe(true);
    expect(r.output).toContain('rate-limited');
  });
});

describe('dispatchApiCall — response parsing', () => {
  test('JSON content-type → parsed pretty', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }) });
    addAllowed('localhost');
    try {
      const r = await dispatchApiCall({ method: 'GET', url: `http://localhost:${server.port}/` });
      expect(r.output).toContain('"a": 1');
    } finally { server.stop(true); }
  });

  test('non-JSON Content-Type returns text', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('plain body', { headers: { 'content-type': 'text/plain' } }) });
    addAllowed('localhost');
    try {
      const r = await dispatchApiCall({ method: 'GET', url: `http://localhost:${server.port}/` });
      expect(r.output).toContain('plain body');
    } finally { server.stop(true); }
  });

  test('non-200 status with default expect_status sets isError', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('not found', { status: 404 }) });
    addAllowed('localhost');
    try {
      const r = await dispatchApiCall({ method: 'GET', url: `http://localhost:${server.port}/` });
      expect(r.isError).toBe(true);
      expect(r.metadata.status).toBe(404);
    } finally { server.stop(true); }
  });

  test('expect_status override accepts unusual codes', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('ok', { status: 418 }) });
    addAllowed('localhost');
    try {
      const r = await dispatchApiCall({ method: 'GET', url: `http://localhost:${server.port}/`, expect_status: [418] });
      expect(r.isError).toBeUndefined();
    } finally { server.stop(true); }
  });
});

describe('dispatchApiCall — body + headers', () => {
  test('object body is JSON-stringified with content-type', async () => {
    let receivedBody = '';
    let receivedCt = '';
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        receivedBody = await req.text();
        receivedCt = req.headers.get('content-type') ?? '';
        return new Response('{}');
      },
    });
    addAllowed('localhost');
    try {
      await dispatchApiCall({
        method: 'POST',
        url: `http://localhost:${server.port}/`,
        body: { a: 1, b: 'x' },
      });
      expect(receivedBody).toBe('{"a":1,"b":"x"}');
      expect(receivedCt).toContain('application/json');
    } finally { server.stop(true); }
  });
});

describe('dispatchApiCall — validation', () => {
  test('missing url rejected', async () => {
    await expect(dispatchApiCall({ method: 'GET' })).rejects.toThrow(/url/);
  });

  test('invalid method rejected', async () => {
    await expect(dispatchApiCall({ method: 'BREW', url: 'https://x' })).rejects.toThrow(/method/);
  });

  test('non-URL string rejected', async () => {
    await expect(dispatchApiCall({ method: 'GET', url: 'not a url' })).rejects.toThrow(/url/);
  });

  test('non-object headers rejected', async () => {
    await expect(dispatchApiCall({ method: 'GET', url: 'https://x', headers: 'bad' })).rejects.toThrow(/headers/);
  });
});

describe('catalog registration', () => {
  test('api_call has hintKeys + cleanerFitThanShell', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const entry = nativeToolCatalog.find(t => t.id === 'api_call');
    expect(entry).toBeDefined();
    expect(entry!.cleanerFitThanShell).toBe(true);
    expect(entry!.hintKeys).toContain('recentNetworkError');
  });
});
