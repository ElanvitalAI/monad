// Test: src/discord/thread-aware.ts
//
// Coverage: thread name conventions · slugify · ThreadContextRegistry ·
// makeThreadRest factory builds correct Discord REST request body.

import { describe, expect, test } from 'bun:test';
import {
  makeThreadRest,
  slugifyForThread,
  THREAD_TYPE_PRIVATE,
  THREAD_TYPE_PUBLIC,
  ThreadContextRegistry,
  threadNameForDepartment,
  threadNameForRoundRobin,
  type ThreadInfo,
} from '../../src/discord/thread-aware.js';

describe('threadNameForRoundRobin', () => {
  test('uses canonical prefix · slug · timestamp', () => {
    const ts = new Date('2026-05-01T15:30:00Z');
    const name = threadNameForRoundRobin('수원-부동산', ts);
    expect(name).toBe('rr · 수원-부동산 · 2026-05-01 15:30');
  });
  test('truncates to 100 chars with ellipsis', () => {
    const long = 'a'.repeat(200);
    const name = threadNameForRoundRobin(long);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('threadNameForDepartment', () => {
  test('without anbun', () => {
    expect(threadNameForDepartment('engineering')).toBe('dept · engineering');
  });
  test('with anbun', () => {
    expect(threadNameForDepartment('engineering', 'PR-1234')).toBe('dept · engineering · PR-1234');
  });
});

describe('slugifyForThread', () => {
  test('replaces whitespace with hyphen', () => {
    expect(slugifyForThread('수원 신축 아파트')).toBe('수원-신축-아파트');
  });
  test('keeps hangul + latin alnum + hyphen, drops other punctuation', () => {
    expect(slugifyForThread('Build #1 AI! @home')).toBe('Build-1-AI-home');
  });
  test('falls back to "topic" on empty / pure punctuation', () => {
    expect(slugifyForThread('!!!')).toBe('topic');
    expect(slugifyForThread('')).toBe('topic');
    expect(slugifyForThread('   ')).toBe('topic');
  });
  test('caps at 60 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugifyForThread(long).length).toBeLessThanOrEqual(60);
  });
});

describe('ThreadContextRegistry', () => {
  const SAMPLE: ThreadInfo = {
    id: 'th-1', name: 'rr · x · y',
    parentChannelId: 'ch-1', archived: false, type: THREAD_TYPE_PUBLIC,
  };

  test('set / get / has / delete', () => {
    const r = new ThreadContextRegistry();
    expect(r.has('lane:plan')).toBe(false);
    r.set('lane:plan', SAMPLE);
    expect(r.has('lane:plan')).toBe(true);
    expect(r.get('lane:plan')).toEqual(SAMPLE);
    expect(r.size()).toBe(1);

    expect(r.delete('lane:plan')).toBe(true);
    expect(r.delete('lane:plan')).toBe(false);
    expect(r.size()).toBe(0);
  });

  test('entries snapshot is independent', () => {
    const r = new ThreadContextRegistry();
    r.set('a', SAMPLE);
    r.set('b', { ...SAMPLE, id: 'th-2' });
    const snap = r.entries();
    expect(snap.length).toBe(2);
    r.clear();
    expect(snap.length).toBe(2);  // snapshot unaffected
    expect(r.size()).toBe(0);
  });
});

describe('makeThreadRest.createThread', () => {
  function makeFakeFetch(responseBody: any, status = 200): {
    fetchImpl: typeof fetch;
    captured: { url: string; method: string; body: any; headers?: any }[];
  } {
    const captured: { url: string; method: string; body: any; headers?: any }[] = [];
    const fetchImpl: typeof fetch = (async (input: any, init: any) => {
      captured.push({
        url: typeof input === 'string' ? input : (input as Request).url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        headers: init?.headers,
      });
      return new Response(JSON.stringify(responseBody), {
        status, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return { fetchImpl, captured };
  }

  test('builds POST /channels/{id}/threads with default type+archive', async () => {
    const { fetchImpl, captured } = makeFakeFetch({
      id: 'th-7', name: 'rr · x · 2026', parent_id: 'ch-1',
      thread_metadata: { archived: false }, type: 11,
    });
    const rest = makeThreadRest({ token: 'abc', fetchImpl });
    const info = await rest.createThread('ch-1', 'rr · x · 2026');

    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe('https://discord.com/api/v10/channels/ch-1/threads');
    expect(captured[0]!.body).toEqual({
      name: 'rr · x · 2026',
      type: THREAD_TYPE_PUBLIC,
      auto_archive_duration: 1440,
    });
    expect(info.id).toBe('th-7');
    expect(info.parentChannelId).toBe('ch-1');
    expect(info.type).toBe(THREAD_TYPE_PUBLIC);
    expect(info.archived).toBe(false);
  });

  test('passes private + invitable + rate limit through', async () => {
    const { fetchImpl, captured } = makeFakeFetch({
      id: 'th-9', name: 'priv', parent_id: 'ch-2',
      thread_metadata: { archived: false }, type: 12,
    });
    const rest = makeThreadRest({ token: 'abc', fetchImpl });
    const info = await rest.createThread('ch-2', 'priv', {
      type: THREAD_TYPE_PRIVATE,
      autoArchiveDuration: 60,
      invitable: false,
      rateLimitPerUser: 10,
    });
    expect(captured[0]!.body).toEqual({
      name: 'priv', type: 12, auto_archive_duration: 60,
      invitable: false, rate_limit_per_user: 10,
    });
    expect(info.type).toBe(THREAD_TYPE_PRIVATE);
  });

  test('throws on Discord error with status', async () => {
    const { fetchImpl } = makeFakeFetch({ message: 'Bad' }, 403);
    const rest = makeThreadRest({ token: 'abc', fetchImpl });
    await expect(rest.createThread('ch-1', 'name')).rejects.toThrow(/createThread.*403/);
  });
});
