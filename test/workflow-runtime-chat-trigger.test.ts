// Surface-unification ROADMAP §B7 (2026-05-11) — chat trigger schema +
// executor pass-through.

import { describe, expect, it } from 'bun:test';
import { validateWorkflow, isChatTriggerNode } from '../src/workflow-runtime/schema';
import { executeChatTriggerNode } from '../src/workflow-runtime/nodes/triggers';
import type { ChatTriggerNode, NodeExecContext, WorkflowDeps } from '../src/workflow-runtime/types';

const ctx = {} as NodeExecContext;
const deps = {} as WorkflowDeps;

function base() {
  return {
    name: 'chat-wf',
    description: 'chat trigger smoke',
    version: 1,
    nodes: [{ id: 'in', chatTrigger: { path: '/chat' } }],
  };
}

describe('chatTrigger schema', () => {
  it('accepts a minimal chat trigger', () => {
    expect(validateWorkflow(base()).ok).toBe(true);
  });

  it("rejects path missing leading '/'", () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['path'] = 'chat';
    expect(validateWorkflow(def).ok).toBe(false);
  });

  it('rejects unknown auth.type', () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['auth'] = { type: 'basic', username: 'a', password: 'b' };
    const r = validateWorkflow(def);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.includes('chatTrigger.auth'))).toBe(true);
  });

  it('accepts bearer auth with token', () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['auth'] = { type: 'bearer', token: 'xyz' };
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it("rejects sessionMode that isn't stateless/per-session", () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['sessionMode'] = 'global';
    expect(validateWorkflow(def).ok).toBe(false);
  });

  it('accepts streaming=true', () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['streaming'] = true;
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it('rejects non-boolean streaming', () => {
    const def = base();
    (def.nodes[0].chatTrigger as Record<string, unknown>)['streaming'] = 'yes';
    expect(validateWorkflow(def).ok).toBe(false);
  });
});

describe('isChatTriggerNode', () => {
  it('identifies chatTrigger nodes', () => {
    const n: ChatTriggerNode = { id: 'c', chatTrigger: { path: '/chat' } };
    expect(isChatTriggerNode(n)).toBe(true);
  });

  it('rejects others', () => {
    expect(isChatTriggerNode({ id: 'b', bash: 'echo' } as never)).toBe(false);
  });
});

describe('executeChatTriggerNode', () => {
  it('passes through with stateless default', async () => {
    const n: ChatTriggerNode = { id: 'c', chatTrigger: { path: '/chat' } };
    const r = await executeChatTriggerNode(n, ctx, deps);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ kind: 'chat', path: '/chat', sessionMode: 'stateless', streaming: false });
  });

  it('echoes per-session + streaming + bearer auth type', async () => {
    const n: ChatTriggerNode = {
      id: 'c',
      chatTrigger: { path: '/research/chat', sessionMode: 'per-session', streaming: true, auth: { type: 'bearer', token: 't' } },
    };
    const r = await executeChatTriggerNode(n, ctx, deps);
    expect(r.output).toEqual({
      kind: 'chat',
      path: '/research/chat',
      sessionMode: 'per-session',
      streaming: true,
      authType: 'bearer',
    });
  });
});
