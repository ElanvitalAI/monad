// ── AgentStop tool · unit tests ──
//
// ROADMAP-agent-surface-deferred-tools Wave 1 · W1.2.
// Covers: not_found / terminal-rejection / abort-dispatch / reason echo /
// spec shape / state-after-call semantics.

import { describe, expect, test } from 'bun:test';

import {
  buildAgentStopTool,
  dispatchAgentStop,
} from '../src/agent/agent-stop-tool.ts';
import { AgentRegistry } from '../src/agent/registry.ts';
import type { AgentDefinition, AgentTask } from '../src/agent/types.ts';
import { debug } from '../src/debug/log.js';

function def(): AgentDefinition {
  return { name: 'stop-test', systemPrompt: '' };
}

function reg(): AgentRegistry { return new AgentRegistry(); }

describe('AgentStop tool', () => {
  test('buildAgentStopTool returns a well-formed LLMToolSpec', () => {
    const spec = buildAgentStopTool();
    expect(spec.name).toBe('AgentStop');
    expect(spec.description).toContain('abort signal');
    expect(spec.parameters.required).toEqual(['taskId']);
    const props = spec.parameters.properties as Record<string, unknown>;
    expect(props['taskId']).toBeDefined();
    expect(props['reason']).toBeDefined();
  });

  test('missing taskId returns not_found', async () => {
    const r = await dispatchAgentStop({}, { registry: reg() });
    expect(r.stopStatus).toBe('not_found');
    expect(r.taskId).toBe('');
    expect(r.output).toContain('missing');
  });

  test('unknown taskId returns not_found', async () => {
    const r = await dispatchAgentStop(
      { taskId: 'no-such-id' },
      { registry: reg() },
    );
    expect(r.stopStatus).toBe('not_found');
    expect(r.taskId).toBe('no-such-id');
  });

  test('terminal task (done) returns already_terminal · no signal sent', async () => {
    const registry = reg();
    const t: AgentTask = registry.register(def(), 'prompt');
    t.state = 'done';
    t.result = 'answer';
    const aborted = t.controller.signal.aborted;

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.stopStatus).toBe('already_terminal');
    expect(r.state).toBe('done');
    expect(t.controller.signal.aborted).toBe(aborted); // unchanged
  });

  test('terminal task (error) returns already_terminal', async () => {
    const registry = reg();
    const t = registry.register(def(), 'prompt');
    t.state = 'error';
    t.error = 'boom';

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.stopStatus).toBe('already_terminal');
    expect(r.state).toBe('error');
    expect(r.output).toContain('error');
  });

  test('terminal task (aborted) returns already_terminal', async () => {
    const registry = reg();
    const t = registry.register(def(), 'prompt');
    t.state = 'aborted';

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.stopStatus).toBe('already_terminal');
    expect(r.state).toBe('aborted');
  });

  test('records abort-signal attempts separately from the later terminal state', async () => {
    const registry = reg();
    const live = registry.register(def(), 'live prompt');
    live.state = 'running';
    debug.disable();
    debug.clear();

    await dispatchAgentStop({ taskId: live.id }, { registry });
    await dispatchAgentStop({ taskId: 'no-such-id' }, { registry });

    const lines = debug.tail(20).filter(line => line.includes('[agent.stop]') && line.includes('dispatch'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(live.id);
    expect(lines[0]).toContain('"stopStatus":"success"');
    expect(lines[0]).toContain('"abortSignalSent":true');
    expect(lines[0]).toContain('"state":"running"');
    expect(lines[0]).not.toContain('"aborted":');
    expect(live.state).toBe('running');

    live.state = 'aborted';
    expect(registry.get(live.id)?.state).toBe('aborted');

    expect(lines[1]).toContain('no-such-id');
    expect(lines[1]).toContain('"stopStatus":"not_found"');
    expect(lines[1]).toContain('"abortSignalSent":false');
  });

  test('running task receives abort signal · stopStatus=success', async () => {
    const registry = reg();
    const t = registry.register(def(), 'prompt');
    t.state = 'running';
    expect(t.controller.signal.aborted).toBe(false);

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.stopStatus).toBe('success');
    expect(r.state).toBe('running'); // state at call · runner flips later
    expect(t.controller.signal.aborted).toBe(true);
  });

  test('pending task receives abort signal · stopStatus=success', async () => {
    const registry = reg();
    const t = registry.register(def(), 'prompt'); // default state=pending
    expect(t.state).toBe('pending');

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.stopStatus).toBe('success');
    expect(r.state).toBe('pending');
    expect(t.controller.signal.aborted).toBe(true);
  });

  test('reason is echoed in the result', async () => {
    const registry = reg();
    const t = registry.register(def(), 'prompt');
    t.state = 'running';

    const r = await dispatchAgentStop(
      { taskId: t.id, reason: 'user cancelled' },
      { registry },
    );
    expect(r.reason).toBe('user cancelled');
  });

  test('label (when present) is echoed in the result', async () => {
    const registry = reg();
    // register() does not accept label · spawn() does, but spawning a
    // real run requires a provider. Set label manually post-register.
    const t = registry.register(def(), 'prompt');
    t.state = 'running';
    t.label = 'data-collector samsung';

    const r = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r.label).toBe('data-collector samsung');
  });

  // ── Wave 3 W3.4 — cascade ──
  test('cascade=true aborts the target and every descendant', async () => {
    const registry = reg();
    const parent = registry.register(def(), 'parent');
    parent.state = 'running';
    const childA = registry.register(def(), 'child A');
    childA.parentTaskId = parent.id;
    childA.state = 'running';
    const childB = registry.register(def(), 'child B');
    childB.parentTaskId = parent.id;
    childB.state = 'running';
    const grandchild = registry.register(def(), 'grandchild');
    grandchild.parentTaskId = childA.id;
    grandchild.state = 'pending';
    const unrelated = registry.register(def(), 'unrelated');
    unrelated.state = 'running'; // no parent link

    const r = await dispatchAgentStop(
      { taskId: parent.id, cascade: true },
      { registry },
    );
    expect(r.stopStatus).toBe('success');
    expect(r.descendantsAborted).toBe(3); // childA + childB + grandchild
    expect(parent.controller.signal.aborted).toBe(true);
    expect(childA.controller.signal.aborted).toBe(true);
    expect(childB.controller.signal.aborted).toBe(true);
    expect(grandchild.controller.signal.aborted).toBe(true);
    expect(unrelated.controller.signal.aborted).toBe(false); // untouched
  });

  test('cascade=true reports descendantsAborted=0 when the target has no children', async () => {
    const registry = reg();
    const parent = registry.register(def(), 'lone');
    parent.state = 'running';

    const r = await dispatchAgentStop(
      { taskId: parent.id, cascade: true },
      { registry },
    );
    expect(r.descendantsAborted).toBe(0);
    expect(r.stopStatus).toBe('success');
    expect(r.output).toContain('cascade=0 descendants');
  });

  test('cascade=true skips already-terminal descendants in the count', async () => {
    const registry = reg();
    const parent = registry.register(def(), 'parent');
    parent.state = 'running';
    const liveChild = registry.register(def(), 'live');
    liveChild.parentTaskId = parent.id;
    liveChild.state = 'running';
    const doneChild = registry.register(def(), 'done');
    doneChild.parentTaskId = parent.id;
    doneChild.state = 'done';

    const r = await dispatchAgentStop(
      { taskId: parent.id, cascade: true },
      { registry },
    );
    expect(r.descendantsAborted).toBe(1); // only the live child counted
    expect(liveChild.controller.signal.aborted).toBe(true);
    expect(doneChild.controller.signal.aborted).toBe(false);
  });

  test('cascade omitted → no descendantsAborted field in result', async () => {
    const registry = reg();
    const parent = registry.register(def(), 'parent');
    parent.state = 'running';
    const child = registry.register(def(), 'child');
    child.parentTaskId = parent.id;
    child.state = 'running';

    const r = await dispatchAgentStop({ taskId: parent.id }, { registry });
    expect(r.stopStatus).toBe('success');
    expect(r.descendantsAborted).toBeUndefined();
    // Child untouched when cascade not requested.
    expect(child.controller.signal.aborted).toBe(false);
  });

  test('second call after abort returns success again until state flips', async () => {
    // The runner is what flips state to 'aborted'. Until that happens
    // the task is still non-terminal, so AgentStop reports success a
    // second time (signal is idempotent on AbortController). This is
    // the documented semantic — AgentOutput(block:true) is the right
    // tool to wait for the actual terminal flip.
    const registry = reg();
    const t = registry.register(def(), 'prompt');
    t.state = 'running';

    const r1 = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r1.stopStatus).toBe('success');

    const r2 = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r2.stopStatus).toBe('success');

    // Once a caller (e.g. test) flips state, AgentStop sees it.
    t.state = 'aborted';
    const r3 = await dispatchAgentStop({ taskId: t.id }, { registry });
    expect(r3.stopStatus).toBe('already_terminal');
  });
});
