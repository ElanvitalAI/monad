// src/nexus/api/autopilot-handler.test.ts
//
// PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B (2026-05-20) —
// `POST /v1/autopilot/<runId>/inject` endpoint unit tests. Validates
// payload coercion, runId lookup miss → 404, kind enum + queue depth
// counting. Active-run registry is module-level so each test resets
// via `_resetAutopilotRunsForTest()`.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  handleAutopilotInject,
  handleAutopilotRun,
  acquireAutopilotAgent,
  _resetAutopilotRunsForTest,
  _listActiveAutopilotRunsForTest,
} from './autopilot-handler.js';

function jsonRequest(body: unknown): Request {
  return new Request('http://x/v1/autopilot/foo/inject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function emptyRequest(): Request {
  // No body — triggers invalid-json on the handler side (req.json() throws).
  return new Request('http://x/v1/autopilot/foo/inject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '',
  });
}

describe('handleAutopilotInject — Phase B', () => {
  beforeEach(() => {
    _resetAutopilotRunsForTest();
  });

  test('unknown runId → 404 / unknown-runId', async () => {
    const res = await handleAutopilotInject(jsonRequest({ instruction: 'x' }), 'no-such-run');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown-runId');
  });

  test('missing instruction → 400', async () => {
    // Register a fake run via the registry — internal seam.
    // Since the inject handler reads activeRuns map, we drive it through
    // the run lifecycle by constructing a minimal fake. Reuse the
    // module's own register/drain seam — keep this thin so the test
    // doesn't depend on driver internals.
    const fakeRun = registerForTest('run-1');
    const res = await handleAutopilotInject(jsonRequest({ instruction: '   ' }), 'run-1');
    expect(res.status).toBe(400);
    expect(fakeRun.injections.length).toBe(0);
  });

  test('empty body / non-JSON → 400 invalid-json', async () => {
    registerForTest('run-2');
    const res = await handleAutopilotInject(emptyRequest(), 'run-2');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid-json');
  });

  test('valid instruction → queues + returns depth', async () => {
    const fakeRun = registerForTest('run-3');
    const res = await handleAutopilotInject(
      jsonRequest({ instruction: 'use dryRun' }),
      'run-3',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; queueDepth: number };
    expect(body.runId).toBe('run-3');
    expect(body.queueDepth).toBe(1);
    expect(fakeRun.injections).toEqual(['use dryRun']);
  });

  test('multiple injects FIFO order preserved', async () => {
    const fakeRun = registerForTest('run-4');
    await handleAutopilotInject(jsonRequest({ instruction: 'a' }), 'run-4');
    await handleAutopilotInject(jsonRequest({ instruction: 'b' }), 'run-4');
    await handleAutopilotInject(jsonRequest({ instruction: 'c' }), 'run-4');
    expect(fakeRun.injections).toEqual(['a', 'b', 'c']);
  });

  test('unsupported kind → 400 kind-not-supported', async () => {
    registerForTest('run-5');
    const res = await handleAutopilotInject(
      jsonRequest({ instruction: 'try', kind: 'replace' }),
      'run-5',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('kind-not-supported');
  });

  test('registry list reflects registered runs', () => {
    registerForTest('alpha');
    registerForTest('beta');
    const list = _listActiveAutopilotRunsForTest();
    expect(list).toContain('alpha');
    expect(list).toContain('beta');
  });

  // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase G · 2026-05-21 —
  // mid-mission inject backend end-to-end verification. Confirms the
  // closure created by `makeDrainerForRun(activeRuns.get(runId))` inside
  // `handleAutopilotRun` sees instructions pushed via the inject endpoint.
  // 사용자 우려 해소: "G3 backend ✅" 가 실제 wire 작동.

  test('Phase G — inject + drain round-trip · FIFO + queue empties after drain', async () => {
    registerForTest('run-g3');
    // Three injects via the production endpoint.
    const r1 = await handleAutopilotInject(jsonRequest({ instruction: 'first' }), 'run-g3');
    expect(r1.status).toBe(200);
    const r2 = await handleAutopilotInject(jsonRequest({ instruction: 'second' }), 'run-g3');
    expect(r2.status).toBe(200);
    const r3 = await handleAutopilotInject(jsonRequest({ instruction: 'third' }), 'run-g3');
    expect(r3.status).toBe(200);
    // queueDepth in the 200 response increments per inject.
    const body3 = (await r3.json()) as { queueDepth: number };
    expect(body3.queueDepth).toBe(3);
    // Driver-side drain (mirror of makeDrainerForRun closure). FIFO.
    const drained = (await import('./autopilot-handler.js'))._drainInjectionsForTest('run-g3');
    expect(drained).toEqual(['first', 'second', 'third']);
    // Subsequent drain returns empty.
    const second = (await import('./autopilot-handler.js'))._drainInjectionsForTest('run-g3');
    expect(second).toEqual([]);
  });

  test('Phase G — inject across drains preserves new-arrival order', async () => {
    registerForTest('run-g3b');
    await handleAutopilotInject(jsonRequest({ instruction: 'iter1-a' }), 'run-g3b');
    await handleAutopilotInject(jsonRequest({ instruction: 'iter1-b' }), 'run-g3b');
    const drain1 = (await import('./autopilot-handler.js'))._drainInjectionsForTest('run-g3b');
    expect(drain1).toEqual(['iter1-a', 'iter1-b']);
    // Inject after the first drain — should land on the next drain only.
    await handleAutopilotInject(jsonRequest({ instruction: 'iter2-a' }), 'run-g3b');
    const drain2 = (await import('./autopilot-handler.js'))._drainInjectionsForTest('run-g3b');
    expect(drain2).toEqual(['iter2-a']);
  });

  test('Phase G — inject after unregister → 404 / unknown-runId', async () => {
    registerForTest('run-g3c');
    const { _unregisterActiveRunForTest } = await import('./autopilot-handler.js');
    _unregisterActiveRunForTest('run-g3c');
    const res = await handleAutopilotInject(jsonRequest({ instruction: 'late' }), 'run-g3c');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown-runId');
  });

  test('Phase G — drain on unknown run returns undefined', async () => {
    const { _drainInjectionsForTest } = await import('./autopilot-handler.js');
    expect(_drainInjectionsForTest('no-such-run')).toBeUndefined();
  });
});

// ── Test-only helper: write into the same module-level Map ──────────
//
// We can't `import { activeRuns }` because it's not exported (module-
// internal singleton). Instead we drive the registry through the same
// public-style helper handleAutopilotRun uses — but only the `register`
// side, since the run wouldn't actually start. Tests that need to read
// back injections use the returned ActiveRun reference.
//
// Implementation: dynamic import of the module's internal seam and
// borrow the `registerActiveRun` symbol via direct require. Tests are
// the only consumer of this back-channel; production handler code goes
// through handleAutopilotRun → registerActiveRun (sibling helper).
//
// 2026-05-20 — keep this helper colocated with the test file so a
// production import audit immediately spots if anything other than
// tests reaches into the registry. If autopilot-handler.ts ever
// exports registerActiveRun directly, drop this in favour of the
// real export.

import * as handlerModule from './autopilot-handler.js';
import type { AcpAgent } from '../../acp/client.js';
import { AcpAgentManager } from '../../acp/agent-manager.js';

describe('acquireAutopilotAgent', () => {
  test('routes codex-app-server through the canonical manager without caller lifecycle ownership', async () => {
    const agent = { start: async () => {}, stop: async () => {} } as unknown as AcpAgent;
    const calls: Array<{ backend: string; cwd?: string }> = [];
    const acquired = await acquireAutopilotAgent('codex-app-server', '/repo', {
      agentManager: { getAgent: async (backend, opts) => {
        calls.push({ backend, cwd: opts?.cwd });
        return agent;
      } },
    });

    expect(calls).toEqual([{ backend: 'codex-app-server', cwd: '/repo' }]);
    expect(acquired.agent).toBe(agent);
    expect(acquired.callerOwnsLifecycle).toBe(false);
  });

  test('honors the injected factory instead of the manager and keeps its lifecycle caller-owned', async () => {
    const agent = { start: async () => {}, stop: async () => {} } as unknown as AcpAgent;
    let injected = 0;
    let managerCalls = 0;
    const acquired = await acquireAutopilotAgent('codex-app-server', '/repo', {
      createAgent: () => { injected += 1; return agent; },
      agentManager: { getAgent: async () => { managerCalls += 1; return agent; } },
    });

    expect(injected).toBe(1);
    expect(managerCalls).toBe(0);
    expect(acquired.agent).toBe(agent);
    expect(acquired.callerOwnsLifecycle).toBe(true);
  });
});

describe('handleAutopilotRun ownership', () => {
  test('disposes its dedicated manager when the stream execution fails', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    let disposed = 0;
    const manager = {
      getAgent: async () => agent,
      dispose: async () => { disposed += 1; },
    } as unknown as AcpAgentManager;
    const req = new Request('http://x/v1/autopilot', {
      method: 'POST',
      body: JSON.stringify({ mission: 'x', backend: 'codex-app-server' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await handleAutopilotRun(req, { createAgentManager: () => manager });
    await response.text();
    expect(disposed).toBe(1);
  });

  test('preserves an SSE error event when dedicated manager disposal rejects', async () => {
    const agent = {
      newSession: async () => { throw new Error('session-failed'); },
      stop: async () => {},
    } as unknown as AcpAgent;
    const manager = {
      getAgent: async () => agent,
      dispose: async () => { throw new Error('dispose-failed'); },
    } as unknown as AcpAgentManager;
    const req = new Request('http://x/v1/autopilot', {
      method: 'POST',
      body: JSON.stringify({ mission: 'x', backend: 'codex-app-server' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await handleAutopilotRun(req, { createAgentManager: () => manager });
    const body = await response.text();
    expect(body).toContain('event: error');
    expect(body).toContain('session-failed');
    expect(body).not.toContain('dispose-failed');
  });

  test('stops an injected agent when start fails without reaching a manager', async () => {
    let stopped = 0;
    const agent = {
      start: async () => { throw new Error('start-failed'); },
      stop: async () => { stopped += 1; },
    } as unknown as AcpAgent;
    const req = new Request('http://x/v1/autopilot', {
      method: 'POST',
      body: JSON.stringify({ mission: 'x', backend: 'codex-app-server' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await handleAutopilotRun(req, { createAgent: () => agent });
    await response.text();
    expect(stopped).toBe(1);
  });
});

interface FakeRunHandle {
  injections: string[];
  abort: AbortController;
}

function registerForTest(runId: string): FakeRunHandle {
  // Reach into the module's private symbol table via the only seam we
  // have today — re-import and call _resetAutopilotRunsForTest to start
  // clean, then push a synthetic entry by re-requiring the module's
  // internals. Bun's ESM doesn't expose the closure variable, so the
  // simplest path is to call the actual `handleAutopilotRun` flow with a
  // mock. Since that's heavy, we instead route through a tiny exposed
  // test seam — added below in autopilot-handler.ts via
  // `_registerActiveRunForTest`. If absent, the test will fail loudly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seam = (handlerModule as any)._registerActiveRunForTest as
    | ((runId: string) => FakeRunHandle)
    | undefined;
  if (!seam) {
    throw new Error(
      'autopilot-handler.ts must export _registerActiveRunForTest for Phase B tests',
    );
  }
  return seam(runId);
}
