import { describe, expect, test } from 'bun:test';
import {
  requestSessionTurnControl,
  SESSION_TURN_CONTROL_PATH,
  type SessionTurnControlDeps,
} from './session-turn-control.js';

// ⛔ NexusPwaResolution 은 url·source 도 «필수」다 — 이 목이 그 둘을 빠뜨린 채
//   4일 동안 tsc 전수에서만 잡혔다(bun test 는 타입-블라인드).
const livePwa = () => ({
  status: 'registered' as const,
  loopback: 'http://127.0.0.1:43127/app/',
  url: 'http://127.0.0.1:43127/app/',
  source: 'local' as const,
});

type RequestCall = { input: string; init?: RequestInit };

function successfulRequest(calls: RequestCall[]): SessionTurnControlDeps['fetchFn'] {
  return async (input, init) => {
    calls.push({ input, init });
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ action: body.action, holder: null, queue: [] }), { status: 200 });
  };
}

describe('session turn control daemon requests', () => {
  test.each([
    ['turn', undefined],
    ['takeover', 'cli:local'],
    ['release', 'cli:local'],
  ] as const)('uses the resolved daemon origin for %s', async (action, key) => {
    const calls: RequestCall[] = [];
    const result = await requestSessionTurnControl('session-1', action, key, {
      resolveNexusPwaFn: livePwa,
      fetchFn: successfulRequest(calls),
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(`http://127.0.0.1:43127${SESSION_TURN_CONTROL_PATH}`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      sessionId: 'session-1',
      action,
      ...(key ? { key } : {}),
    });
    expect(result).toEqual({ action, holder: null, queue: [] });
  });

  test('does not request a fallback address when the daemon is unavailable', async () => {
    const calls: RequestCall[] = [];
    let runtimeReads = 0;
    const unavailable = () => ({ status: 'absent' as const, reason: 'daemon-absent' as const });

    await expect(requestSessionTurnControl('session-1', 'turn', undefined, {
      resolveNexusPwaFn: unavailable,
      readNexusRuntimeFn: () => {
        runtimeReads += 1;
        return { pid: 1, startedAt: 'now', nexusVersion: 'test', phase: 'test', httpPort: 39999, httpHost: '127.0.0.1' };
      },
      fetchFn: successfulRequest(calls),
    })).rejects.toThrow(/Nexus daemon could not be found \(daemon-absent\).*elanous nexus run/);
    expect(runtimeReads).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('does not request a fallback address when daemon resolution throws', async () => {
    const calls: RequestCall[] = [];

    await expect(requestSessionTurnControl('session-1', 'turn', undefined, {
      resolveNexusPwaFn: () => { throw new Error('sidecar unavailable'); },
      fetchFn: successfulRequest(calls),
    })).rejects.toThrow(/Nexus daemon could not be found \(sidecar unavailable\).*elanous nexus run/);
    expect(calls).toHaveLength(0);
  });

  test('keeps HTTP response failures distinct from daemon discovery failures', async () => {
    const calls: RequestCall[] = [];
    const failingFetch: SessionTurnControlDeps['fetchFn'] = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: 'turn is held' }), { status: 409 });
    };

    await expect(requestSessionTurnControl('session-1', 'turn', undefined, {
      resolveNexusPwaFn: livePwa,
      fetchFn: failingFetch,
    })).rejects.toThrow('turn is held');
    expect(calls).toHaveLength(1);
  });
});
