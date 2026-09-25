// ── Session dedup cache ──
//
// Guards against the context-bloat failure mode where a parent skill
// loop re-issues identical Read/Agent calls: each repeat dumped the
// same 60KB payload into history until the context exploded.
//
// These tests lock the three pieces:
//   1. SessionCache miss → undefined, subsequent check after noteSeen → hit w/ hits++
//   2. readCacheKey / agentCacheKey produce stable keys for same input
//   3. dedupeStub wording includes the "already issued" + hint substrings

import { describe, test, expect } from 'bun:test';
import {
  SessionCache, readCacheKey, agentCacheKey, dedupeStub,
} from '../src/session/cache';

describe('SessionCache', () => {
  test('check returns undefined on miss', () => {
    const c = new SessionCache();
    expect(c.check('foo')).toBeUndefined();
  });

  test('noteSeen + second check returns entry', () => {
    const c = new SessionCache();
    c.noteSeen('k', 'label');
    const hit = c.check('k');
    expect(hit).toBeDefined();
    expect(hit!.label).toBe('label');
  });

  test('hits counter increments on repeat checks', () => {
    const c = new SessionCache();
    c.noteSeen('k', 'l');
    c.check('k');
    c.check('k');
    const h = c.check('k');
    expect(h!.hits).toBe(3);
  });

  test('noteSeen is idempotent — second call does not overwrite timestamp', () => {
    const c = new SessionCache();
    c.noteSeen('k', 'first-label');
    const firstTs = c.check('k')!.firstSeenAt;
    c.noteSeen('k', 'different-label');
    expect(c.check('k')!.label).toBe('first-label');
    expect(c.check('k')!.firstSeenAt).toBe(firstTs);
  });

  test('clear resets all entries', () => {
    const c = new SessionCache();
    c.noteSeen('a', 'a');
    c.noteSeen('b', 'b');
    expect(c.size).toBe(2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.check('a')).toBeUndefined();
  });

  test('totalHits counts cumulative cache hits across all keys', () => {
    const c = new SessionCache();
    expect(c.totalHits).toBe(0);
    c.noteSeen('a', 'a');
    c.noteSeen('b', 'b');
    expect(c.totalHits).toBe(0);    // noteSeen doesn't bump
    c.check('a'); c.check('a');     // 2 hits on 'a'
    c.check('b');                    // 1 hit on 'b'
    c.check('nope');                 // miss — no bump
    expect(c.totalHits).toBe(3);
  });

  test('clear resets totalHits too', () => {
    const c = new SessionCache();
    c.noteSeen('k', 'l');
    c.check('k'); c.check('k');
    expect(c.totalHits).toBe(2);
    c.clear();
    expect(c.totalHits).toBe(0);
  });
});

describe('readCacheKey', () => {
  test('same inputs → same key', () => {
    expect(readCacheKey('/foo/bar', 1, 5000))
      .toBe(readCacheKey('/foo/bar', 1, 5000));
  });
  test('different offset → different key', () => {
    expect(readCacheKey('/a', 1, 100))
      .not.toBe(readCacheKey('/a', 2, 100));
  });
  test('different limit → different key', () => {
    expect(readCacheKey('/a', 1, 100))
      .not.toBe(readCacheKey('/a', 1, 200));
  });
});

describe('agentCacheKey', () => {
  test('same inputs → same key (hash stability)', () => {
    const k1 = agentCacheKey('desc', 'general-purpose', 'analyze X');
    const k2 = agentCacheKey('desc', 'general-purpose', 'analyze X');
    expect(k1).toBe(k2);
  });
  test('prompt difference → different key', () => {
    const k1 = agentCacheKey('desc', 'general-purpose', 'analyze X');
    const k2 = agentCacheKey('desc', 'general-purpose', 'analyze Y');
    expect(k1).not.toBe(k2);
  });
  test('subagent_type difference → different key', () => {
    const k1 = agentCacheKey('desc', 'general-purpose', 'p');
    const k2 = agentCacheKey('desc', 'explorer', 'p');
    expect(k1).not.toBe(k2);
  });
  test('key is bounded length (hashed)', () => {
    const longPrompt = 'x'.repeat(100_000);
    const k = agentCacheKey('d', 'general-purpose', longPrompt);
    expect(k.length).toBeLessThan(40);
  });
});

describe('dedupeStub', () => {
  test('includes DUPLICATE CALL marker + label + note', () => {
    const stub = dedupeStub('Read /foo', 2, Date.now() - 5000, 'use previous');
    expect(stub).toContain('DUPLICATE CALL');
    expect(stub).toContain('Read /foo');
    expect(stub).toContain('use previous');
    expect(stub).toMatch(/\d+s ago/);
    expect(stub).toContain('repeat #2');
  });
});
