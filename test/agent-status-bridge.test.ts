// ── Agent status bridge · unit tests ──
//
// ROADMAP-agent-surface-deferred-tools-2026-05-13 § Wave 1.5.
// Covers: terminal-state envelope emission, getSessionId suppression,
// status enum mapping, error/aborted handling, emit isolation,
// dispose.

import { describe, expect, test } from 'bun:test';

import {
  deriveAgentStatusPayload,
  makeAgentStatusBlockId,
  wireAgentStatusBridge,
} from '../src/agent/agent-status-bridge.ts';
import { AgentRegistry } from '../src/agent/registry.ts';
import type { AgentDefinition, AgentTask } from '../src/agent/types.ts';
import type { FeedbackEnvelope } from '../src/feedback/envelope.ts';

function def(): AgentDefinition {
  return { name: 'status-test', systemPrompt: '' };
}

function makeBag(): {
  envelopes: FeedbackEnvelope[];
  emit: (env: FeedbackEnvelope) => void;
} {
  const envelopes: FeedbackEnvelope[] = [];
  return {
    envelopes,
    emit: (env) => { envelopes.push(env); },
  };
}

function flipAndNotify(
  registry: AgentRegistry,
  task: AgentTask,
  state: 'done' | 'error' | 'aborted',
  patch?: Partial<AgentTask>,
): void {
  task.state = state;
  task.startedAt = task.startedAt ?? Date.now() - 50;
  task.finishedAt = Date.now();
  if (patch) Object.assign(task, patch);
  registry.notifyTaskDone(task);
}

describe('agent-status-bridge', () => {
  test('deriveAgentStatusPayload returns null for non-terminal states', () => {
    const t: AgentTask = {
      id: 't1', definition: def(), state: 'pending',
      prompt: 'p', messages: [], controller: new AbortController(),
    };
    expect(deriveAgentStatusPayload(t)).toBeNull();
    t.state = 'running';
    expect(deriveAgentStatusPayload(t)).toBeNull();
  });

  test('deriveAgentStatusPayload maps done', () => {
    const t: AgentTask = {
      id: 'done-id', definition: def(), state: 'done',
      prompt: 'p', messages: [], controller: new AbortController(),
    };
    const p = deriveAgentStatusPayload(t);
    expect(p?.status).toBe('done');
    expect(p?.agentId).toBe('done-id');
    expect(p?.lastEvent).toBeUndefined();
  });

  test('deriveAgentStatusPayload maps error · echoes task.error', () => {
    const t: AgentTask = {
      id: 'err-id', definition: def(), state: 'error', error: 'boom',
      prompt: 'p', messages: [], controller: new AbortController(),
    };
    const p = deriveAgentStatusPayload(t);
    expect(p?.status).toBe('error');
    expect(p?.lastEvent).toBe('boom');
  });

  test('deriveAgentStatusPayload folds aborted into error · lastEvent="aborted"', () => {
    const t: AgentTask = {
      id: 'abort-id', definition: def(), state: 'aborted',
      prompt: 'p', messages: [], controller: new AbortController(),
    };
    const p = deriveAgentStatusPayload(t);
    expect(p?.status).toBe('error');
    expect(p?.lastEvent).toBe('aborted');
  });

  test('makeAgentStatusBlockId follows {sessionId}:agent-status:{taskId} convention', () => {
    expect(makeAgentStatusBlockId('s-1', 't-9')).toBe('s-1:agent-status:t-9');
  });

  test('wireAgentStatusBridge emits envelope on terminal transition', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-A',
      registry,
    });

    const task = registry.register(def(), 'prompt');
    flipAndNotify(registry, task, 'done', { result: 'ok' });

    expect(bag.envelopes).toHaveLength(1);
    const env = bag.envelopes[0]!;
    expect(env.kind).toBe('agent.status');
    expect(env.sessionId).toBe('sess-A');
    expect(env.blockId).toBe(`sess-A:agent-status:${task.id}`);
    expect(env.phase).toBe('update');
    expect(env.seq).toBe(1);
    expect(env.asciiFallback.length).toBeGreaterThan(0);
    const payload = (env as { payload: { status: string; agentId: string } }).payload;
    expect(payload.status).toBe('done');
    expect(payload.agentId).toBe(task.id);
  });

  test('getSessionId returning null suppresses emit', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => null,
      registry,
    });
    const task = registry.register(def(), 'prompt');
    flipAndNotify(registry, task, 'done');
    expect(bag.envelopes).toHaveLength(0);
  });

  test('error task emits payload with lastEvent = error message', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-B',
      registry,
    });
    const task = registry.register(def(), 'prompt');
    flipAndNotify(registry, task, 'error', { error: 'kaboom' });

    expect(bag.envelopes).toHaveLength(1);
    const payload = (bag.envelopes[0] as { payload: { status: string; lastEvent?: string } }).payload;
    expect(payload.status).toBe('error');
    expect(payload.lastEvent).toBe('kaboom');
  });

  test('aborted task emits payload with lastEvent = "aborted"', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-C',
      registry,
    });
    const task = registry.register(def(), 'prompt');
    flipAndNotify(registry, task, 'aborted');

    expect(bag.envelopes).toHaveLength(1);
    const payload = (bag.envelopes[0] as { payload: { status: string; lastEvent?: string } }).payload;
    expect(payload.status).toBe('error');
    expect(payload.lastEvent).toBe('aborted');
  });

  test('multiple tasks share a bridge · seq tracks per-blockId', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-D',
      registry,
    });
    const t1 = registry.register(def(), 'p1');
    const t2 = registry.register(def(), 'p2');
    flipAndNotify(registry, t1, 'done');
    flipAndNotify(registry, t2, 'done');

    expect(bag.envelopes).toHaveLength(2);
    // Different blockIds (different taskIds), so each starts at seq=1.
    expect(bag.envelopes[0]!.seq).toBe(1);
    expect(bag.envelopes[1]!.seq).toBe(1);
    expect(bag.envelopes[0]!.blockId).not.toBe(bag.envelopes[1]!.blockId);
  });

  test('emit error in one listener does not wedge subsequent emits', () => {
    const registry = new AgentRegistry();
    let emitCount = 0;
    wireAgentStatusBridge({
      emit: () => { emitCount++; throw new Error('emitter broken'); },
      getSessionId: () => 'sess-E',
      registry,
    });
    const t1 = registry.register(def(), 'p');
    flipAndNotify(registry, t1, 'done');
    const t2 = registry.register(def(), 'p2');
    flipAndNotify(registry, t2, 'done');
    expect(emitCount).toBe(2); // both fired despite each throwing
  });

  test('dispose stops further emissions', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    const handle = wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-F',
      registry,
    });
    const t1 = registry.register(def(), 'p1');
    flipAndNotify(registry, t1, 'done');
    expect(bag.envelopes).toHaveLength(1);

    handle.dispose();
    const t2 = registry.register(def(), 'p2');
    flipAndNotify(registry, t2, 'done');
    expect(bag.envelopes).toHaveLength(1); // unchanged
  });

  test('label appears in asciiFallback', () => {
    const registry = new AgentRegistry();
    const bag = makeBag();
    wireAgentStatusBridge({
      emit: bag.emit,
      getSessionId: () => 'sess-G',
      registry,
    });
    const task = registry.register(def(), 'p');
    task.label = 'data-collector A';
    flipAndNotify(registry, task, 'done');

    expect(bag.envelopes[0]!.asciiFallback.join('\n')).toContain('data-collector A');
    expect(bag.envelopes[0]!.asciiFallback.join('\n')).toContain('done');
  });
});
