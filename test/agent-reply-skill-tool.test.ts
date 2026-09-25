// H6 P5 · AgentReply LLM tool contract.

import { describe, test, expect } from 'bun:test';
import {
  buildAgentReplyTool,
  dispatchAgentReply,
  initAgentReplyTools,
} from '../src/skills/tools/agent-reply.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { ReplyDeps } from '../src/agent/reply.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import { debug } from '../src/debug/log.js';

function makeSession(id: string): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'stub' },
    transports: [{ kind: 'pty', id: `pty-${id}` }],
    state: () => ({ status: 'running' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

class FakeObserver {
  state: Record<string, string> = {};
  append(channel: string, chunk: string) {
    this.state[channel] = (this.state[channel] ?? '') + chunk;
  }
  snapshotChannels() { return { ...this.state }; }
}

describe('AgentReply tool spec', () => {
  test('name · description mentions complementary AgentHandoff', () => {
    const spec = buildAgentReplyTool();
    expect(spec.name).toBe('AgentReply');
    expect(spec.description).toMatch(/AgentHandoff/);
  });

  test('required params = [toSessionId, message]', () => {
    const spec = buildAgentReplyTool();
    const required = (spec.parameters as { required?: string[] }).required;
    expect(required).toContain('toSessionId');
    expect(required).toContain('message');
  });

  test('optional params include fromSessionId · includeChannels · idleMs · timeoutMs', () => {
    const spec = buildAgentReplyTool();
    const props = (spec.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['fromSessionId', 'includeChannels', 'idleMs', 'timeoutMs']),
    );
  });
});

describe('dispatchAgentReply · input validation', () => {
  test('missing toSessionId · isError', async () => {
    const r = await dispatchAgentReply({ message: 'hi' });
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/toSessionId required/);
  });

  test('records distinct delivery reasons for empty message and absent target', async () => {
    debug.enable();
    debug.clear();

    const emptyMessage = await dispatchAgentReply({ toSessionId: 't1', message: '' });
    const emptyMessageLine = debug.tail(10).find(line => line.includes('[agent.reply] dispatch'));

    debug.clear();
    const absentTarget = await dispatchAgentReply({ toSessionId: 'does-not-exist', message: 'hi' });
    const absentTargetLine = debug.tail(10).find(line => line.includes('[agent.reply] dispatch'));

    expect(emptyMessage.isError).toBe(true);
    expect(emptyMessage.output).toMatch(/message must be non-empty/);
    expect(emptyMessageLine).toContain('"toSessionId":"t1"');
    expect(emptyMessageLine).toContain('"delivered":false');
    expect(emptyMessageLine).toContain('"deliveryReason":"empty_message"');
    expect(absentTarget.isError).toBe(true);
    expect(absentTarget.output).toMatch(/not found/);
    expect(absentTargetLine).toContain('"toSessionId":"does-not-exist"');
    expect(absentTargetLine).toContain('"delivered":false');
    expect(absentTargetLine).toContain('"deliveryReason":"send_failed"');
    expect(emptyMessageLine).not.toBe(absentTargetLine);
  });
});

describe('dispatchAgentReply · happy path via stub deps', () => {
  test('returns structured metadata and records a delivered reply', async () => {
    debug.enable();
    debug.clear();
    const target = makeSession('t1');
    const observer = new FakeObserver();
    const graph = new AgentGraph();
    let tick = 0;
    const deps: ReplyDeps = {
      lookup: { findSession: (id) => (id === 't1' ? target : undefined) },
      observerLookup: (id) => (id === 't1' ? (observer as never) : undefined),
      graph,
      now: () => 1000 + tick * 100,
      sleep: async () => {
        if (tick === 0) observer.append('message', 'hi back');
        tick += 1;
      },
    };
    const r = await dispatchAgentReply(
      { toSessionId: 't1', message: 'hello', idleMs: 100, timeoutMs: 1000 },
      deps,
    );
    expect(r.isError).toBeUndefined();
    expect(r.metadata.toSessionId).toBe('t1');
    expect(r.metadata.replyText).toBe('hi back');
    expect(r.metadata.cycleDepth).toBe(1);
    expect(typeof r.metadata.elapsedMs).toBe('number');
    const line = debug.tail(10).find(line => line.includes('[agent.reply] dispatch'));
    expect(line).toBeDefined();
    expect(line!).toContain('"toSessionId":"t1"');
    expect(line!).toContain('"delivered":true');
    expect(line!).not.toContain('deliveryReason');
  });
});

describe('initAgentReplyTools bootstrap', () => {
  test('no-op idempotent · safe to call multiple times', () => {
    expect(() => { initAgentReplyTools(); initAgentReplyTools(); }).not.toThrow();
  });
});
