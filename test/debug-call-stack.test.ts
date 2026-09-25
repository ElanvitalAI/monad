import { describe, expect, test } from 'bun:test';
import { buildDebugCallStack } from '../src/debug/call-stack.js';
import type { DebugEvent } from '../src/debug/log.js';
import type { AgentSurfaceState } from '../src/display/agent-surface.js';

const ts = (s: string) => `2026-04-16T${s}.000Z`;

describe('debug call stack', () => {
  test('prioritizes active agents and includes their tool trail', () => {
    const agents: AgentSurfaceState[] = [
      agent({ id: 'done', status: 'done', name: 'Done Agent', updatedAt: 10 }),
      agent({
        id: 'run',
        status: 'running',
        name: 'Worker',
        updatedAt: 20,
        log: [{ level: 'tool', text: '\x1b[33m⎿\x1b[0m Read {"file":"a.ts"}' }],
      }),
    ];

    const frames = buildDebugCallStack({ events: [], agents });

    expect(frames[0]).toMatchObject({
      id: 'agent:run',
      kind: 'agent',
      status: 'active',
      label: 'Worker',
    });
    expect(frames[0]?.children?.[0]).toMatchObject({
      kind: 'tool',
      label: '⎿ Read {"file":"a.ts"}',
    });
  });

  test('adds latest LLM signal and recent runtime events', () => {
    const request = event('llm.request', 'POST /v1/responses', ts('01:00:00'));
    const response = event('llm.response.complete', 'complete', ts('01:00:02'));
    const frames = buildDebugCallStack({
      events: [
        event('plugin.tool.done', 'debug_getState', ts('01:00:03'), { durationMs: 4 }),
        event('key.route', 'ignored', ts('01:00:04')),
      ],
      lastLlm: { request, response },
    });

    expect(frames.some(frame => frame.kind === 'llm' && frame.status === 'done')).toBe(true);
    expect(frames.some(frame => frame.kind === 'plugin' && frame.label === 'plugin.tool.done -> debug_getState')).toBe(true);
    expect(frames.some(frame => frame.source?.category === 'key.route')).toBe(false);
  });
});

function agent(overrides: Partial<AgentSurfaceState>): AgentSurfaceState {
  return {
    id: 'a',
    name: 'Agent',
    definitionName: 'general-purpose',
    status: 'queued',
    elapsedMs: 0,
    toolCount: 0,
    log: [],
    updatedAt: 0,
    ...overrides,
  };
}

function event(category: string, name: string, at: string, data?: unknown): DebugEvent {
  return {
    ts: at,
    category,
    event: name,
    ...(data !== undefined ? { data } : {}),
  };
}
