// Slash-command-level tests for /api-allow. The actual TUI dispatch
// lives inside dashboard.ts's interactive loop, which is hard to
// drive in a unit test. We exercise the underlying allowlist API
// through the same call shapes the slash handler uses, plus the
// command-registration declaration.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  addAllowed,
  hostOf,
  listAllowed,
  rateLimitStatus,
  removeAllowed,
  setAllowlistPathForTesting,
  setRateLimitsForTesting,
} from '../src/tool-hints/api-allowlist.js';
import { SLASH_COMMANDS } from '../src/chat/index.js';

let tmp: string;

beforeEach(() => {
  tmp = joinPath(tmpdir(), `mh-apallow-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  setAllowlistPathForTesting(joinPath(tmp, 'api-allow.json'));
  setRateLimitsForTesting();
});

afterEach(() => {
  setAllowlistPathForTesting(null);
  setRateLimitsForTesting();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('/api-allow command registration', () => {
  test('SLASH_COMMANDS contains api-allow with subcommands', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'api-allow');
    expect(cmd).toBeDefined();
    expect(cmd!.subcommands).toEqual(['add', 'remove', 'list', 'clear']);
  });

  test('"api" alias resolves to the same command', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'api-allow');
    expect(cmd!.aliases).toContain('api');
  });
});

describe('/api-allow add path', () => {
  test('persistent add round-trips through the file', () => {
    const e = addAllowed('https://api.github.com/some/path', { reason: 'PR triage' });
    expect(e?.host).toBe('api.github.com');
    expect(listAllowed().some(x => x.host === 'api.github.com')).toBe(true);
  });

  test('session-only add does NOT survive a path reset', () => {
    addAllowed('localhost', { sessionOnly: true });
    expect(listAllowed().some(x => x.host === 'localhost')).toBe(true);
    // Re-pointing the test config wipes session+persistent caches.
    setAllowlistPathForTesting(joinPath(tmp, 'api-allow.json'));
    expect(listAllowed().some(x => x.host === 'localhost')).toBe(false);
  });

  test('hostOf normalizes URLs and bare hostnames consistently', () => {
    expect(hostOf('https://api.example.com/x')).toBe('api.example.com');
    expect(hostOf('api.example.com')).toBe('api.example.com');
    expect(hostOf('  EXAMPLE.com  ')).toBe('example.com');
  });
});

describe('/api-allow remove path', () => {
  test('removes a previously added host', () => {
    addAllowed('one.example.com');
    expect(removeAllowed('one.example.com')).toBe(true);
    expect(listAllowed().some(x => x.host === 'one.example.com')).toBe(false);
  });

  test('returns false for missing host', () => {
    expect(removeAllowed('nothing.example.com')).toBe(false);
  });
});

describe('/api-allow list + rate budget surfaced together', () => {
  test('rateLimitStatus is queryable per-host without consuming budget', () => {
    setRateLimitsForTesting({ perHost: 5, global: 100 });
    addAllowed('host.example.com');
    const before = rateLimitStatus('https://host.example.com/x');
    expect(before.hostRemaining).toBe(5);
    expect(before.globalRemaining).toBe(100);
    // Calling status again returns the same numbers.
    const after = rateLimitStatus('https://host.example.com/x');
    expect(after.hostRemaining).toBe(5);
  });
});

describe('/api-allow clear path', () => {
  test('removes every entry', () => {
    addAllowed('a.example.com');
    addAllowed('b.example.com');
    addAllowed('localhost', { sessionOnly: true });
    let removed = 0;
    for (const e of listAllowed()) if (removeAllowed(e.host)) removed++;
    expect(removed).toBe(3);
    expect(listAllowed()).toEqual([]);
  });
});
