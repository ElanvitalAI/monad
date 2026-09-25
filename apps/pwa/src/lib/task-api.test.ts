/**
 * NEXUS T3 endpoint contract test for TaskApi (`/v1/tasks`).
 *
 * fetch mock 으로 list + detail (path-segment encoding) 검증.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DaemonClient } from './daemon-client';
import { TaskApi } from './task-api';

interface FetchCall { url: string | URL }

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function mockResponse(opts: { status: number; body: unknown }): typeof fetch {
  return ((async (input: RequestInfo | URL) => {
    calls.push({ url: input as string | URL });
    return {
      ok: opts.status >= 200 && opts.status < 300,
      status: opts.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => opts.body,
      text: async () => JSON.stringify(opts.body),
    } as unknown as Response;
  }) as unknown) as typeof fetch;
}

function makeClient(): DaemonClient {
  return new DaemonClient({
    baseUrl: 'http://localhost:31415',
    token: '',
    provider: 'anthropic',
  });
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('TaskApi.list — GET /v1/tasks', () => {
  it('returns the daemon summary + tasks shape verbatim', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: {
        summary: {
          total: 5,
          open: 3,
          terminal: 2,
          linkedScheduler: 1,
          byStatus: { ready: 2, done: 2, blocked: 1 },
          byPriority: { medium: 4, high: 1 },
        },
        tasks: [
          {
            id: 'task-1',
            title: 'milk',
            dryRun: false,
            status: 'ready',
            priority: 'medium',
            surfaceKind: 'pwa',
            createdAt: 0,
            updatedAt: 0,
            attempt: 0,
            maxRetries: 0,
            notesTail: [],
            acceptanceCount: 0,
          },
        ],
      },
    });
    const api = new TaskApi(makeClient());
    const result = await api.list();
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/tasks');
    expect(result.summary.total).toBe(5);
    expect(result.tasks[0]?.id).toBe('task-1');
  });

  it('throws on 503 not-wired', async () => {
    globalThis.fetch = mockResponse({
      status: 503,
      body: { error: 'meta-api-runtime-not-wired' },
    });
    const api = new TaskApi(makeClient());
    await expect(api.list()).rejects.toThrow(/meta-api-runtime-not-wired/);
  });
});

describe('TaskApi.detail — GET /v1/tasks/:taskId', () => {
  it('encodes the taskId path segment for slashes', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: {
        task: {
          id: 'a/b',
          createdAt: 0,
          updatedAt: 0,
          version: 1,
          title: 't',
          description: '',
          surface: { kind: 'pwa' },
          dependsOn: [],
          priority: 'medium',
          isolation: 'process',
          maxRetries: 0,
          attempt: 0,
          status: 'ready',
          notes: [],
        },
        executions: [],
        events: [],
      },
    });
    const api = new TaskApi(makeClient());
    await api.detail('a/b');
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/tasks/a%2Fb');
  });
});
