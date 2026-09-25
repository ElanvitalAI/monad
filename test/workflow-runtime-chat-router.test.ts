// Surface-unification v2 (2026-05-11) — chat router tests.

import { describe, expect, it } from 'bun:test';
import { buildChatRouter, type ChatRegistryEntry } from '../src/workflow-runtime/triggers/chat-router';

const registry: ChatRegistryEntry[] = [
  {
    workflowName: 'research',
    nodeId: 'in',
    trigger: { path: '/research', sessionMode: 'stateless' },
  },
  {
    workflowName: 'secret',
    nodeId: 'in',
    trigger: {
      path: '/secret',
      sessionMode: 'stateless',
      auth: { type: 'bearer', token: 'shh' },
    },
  },
];

describe('buildChatRouter', () => {
  it('returns 404 for unknown path', async () => {
    const dispatch = buildChatRouter({
      registry,
      runWorkflow: async () => ({ ok: true as const, output: 'x', runId: 'r' }),
    });
    const res = await dispatch({ path: '/unknown', body: { message: 'hi' } });
    expect(res.status).toBe(404);
  });

  it('returns 400 when message missing', async () => {
    const dispatch = buildChatRouter({
      registry,
      runWorkflow: async () => ({ ok: true as const, output: 'x', runId: 'r' }),
    });
    const res = await dispatch({ path: '/research', body: {} });
    expect(res.status).toBe(400);
  });

  it('runs workflow when path matches + returns response', async () => {
    let called: { msg?: string; sessionId?: string } = {};
    const dispatch = buildChatRouter({
      registry,
      runWorkflow: async (_e, message, sessionId) => {
        called = { msg: message, sessionId };
        return { ok: true as const, output: `echo ${message}`, runId: 'r-1' };
      },
    });
    const res = await dispatch({
      path: '/research',
      body: { message: 'hello', sessionId: 's1' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, response: 'echo hello', runId: 'r-1', workflowName: 'research' });
    expect(called).toEqual({ msg: 'hello', sessionId: 's1' });
  });

  it('enforces bearer auth when configured', async () => {
    const dispatch = buildChatRouter({
      registry,
      runWorkflow: async () => ({ ok: true as const, output: 'x', runId: 'r' }),
    });
    const noAuth = await dispatch({ path: '/secret', body: { message: 'hi' } });
    expect(noAuth.status).toBe(401);
    const ok = await dispatch({ path: '/secret', authorization: 'Bearer shh', body: { message: 'hi' } });
    expect(ok.status).toBe(200);
    const bad = await dispatch({ path: '/secret', authorization: 'Bearer wrong', body: { message: 'hi' } });
    expect(bad.status).toBe(401);
  });

  it('returns 500 when workflow dispatch fails', async () => {
    const dispatch = buildChatRouter({
      registry,
      runWorkflow: async () => ({ ok: false as const, error: 'boom' }),
    });
    const res = await dispatch({ path: '/research', body: { message: 'hi' } });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'boom' });
  });

  describe('register / unregister · post-start path mutation', () => {
    it('register adds a new path that dispatch can route to', async () => {
      const dispatch = buildChatRouter({
        registry: [],
        runWorkflow: async () => ({ ok: true as const, output: 'late-reply', runId: 'r' }),
      });
      // pre-register: 404
      const before = await dispatch({ path: '/late', body: { message: 'hi' } });
      expect(before.status).toBe(404);

      dispatch.register({
        workflowName: 'late',
        nodeId: 'in',
        trigger: { path: '/late', sessionMode: 'stateless' },
      });
      const after = await dispatch({ path: '/late', body: { message: 'hi' } });
      expect(after.status).toBe(200);
    });

    it('register on an existing path replaces the entry (idempotent)', async () => {
      const calls: string[] = [];
      const dispatch = buildChatRouter({
        registry: [{ workflowName: 'first', nodeId: 'in', trigger: { path: '/p', sessionMode: 'stateless' } }],
        runWorkflow: async (entry) => {
          calls.push(entry.workflowName);
          return { ok: true as const, output: 'r', runId: '1' };
        },
      });
      dispatch.register({
        workflowName: 'second',
        nodeId: 'in',
        trigger: { path: '/p', sessionMode: 'stateless' },
      });
      await dispatch({ path: '/p', body: { message: 'hi' } });
      expect(calls).toEqual(['second']);
    });

    it('unregister removes a path · dispatch returns 404 after', async () => {
      const dispatch = buildChatRouter({
        registry: [{ workflowName: 'a', nodeId: 'in', trigger: { path: '/a', sessionMode: 'stateless' } }],
        runWorkflow: async () => ({ ok: true as const, output: 'x', runId: 'r' }),
      });
      expect(dispatch.unregister('/a')).toBe(true);
      const res = await dispatch({ path: '/a', body: { message: 'hi' } });
      expect(res.status).toBe(404);
      expect(dispatch.unregister('/a')).toBe(false);
    });

    it('paths() snapshot reflects mutations', async () => {
      const dispatch = buildChatRouter({
        registry: [{ workflowName: 'a', nodeId: 'in', trigger: { path: '/a', sessionMode: 'stateless' } }],
        runWorkflow: async () => ({ ok: true as const, output: 'x', runId: 'r' }),
      });
      expect(dispatch.paths()).toEqual(['/a']);
      dispatch.register({ workflowName: 'b', nodeId: 'in', trigger: { path: '/b', sessionMode: 'stateless' } });
      expect([...dispatch.paths()].sort()).toEqual(['/a', '/b']);
    });
  });
});
