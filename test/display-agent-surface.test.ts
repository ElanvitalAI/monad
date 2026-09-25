import { describe, expect, test } from 'bun:test';
import {
  AgentSurfaceStore,
  agentTaskToSurfaceState,
  renderAgentDetail,
  renderAgentRoster,
} from '../src/display/index.js';
import type { AgentTask } from '../src/agent/types.js';
import type { ContentBlock } from '../src/llm.js';
import { stripAnsi } from '../src/tui.js';

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'agent-1',
    definition: {
      name: 'default',
      description: 'Default sub-agent for delegated work',
      systemPrompt: 'work carefully',
    },
    label: 'Scan repository',
    state: 'running',
    prompt: 'inspect files',
    messages: [],
    startedAt: 1_000,
    controller: new AbortController(),
    ...overrides,
  };
}

const toolUse = (name: string, input: Record<string, unknown>): ContentBlock => ({
  type: 'tool_use',
  id: `${name}-1`,
  name,
  input,
});

describe('agent surface adapter', () => {
  test('maps AgentTask into display state with label, status, tools, and log', () => {
    const state = agentTaskToSurfaceState(task({
      messages: [
        { role: 'assistant', content: [toolUse('Read', { path: 'src/dashboard.ts' })] },
        { role: 'assistant', content: [toolUse('Grep', { query: 'AgentSurface' })] },
      ],
    }), { now: 6_000 });

    expect(state).toMatchObject({
      id: 'agent-1',
      name: 'Scan repository',
      definitionName: 'default',
      status: 'running',
      elapsedMs: 5_000,
      toolCount: 2,
    });
    expect(state.log.map(entry => stripAnsi(entry.text)).join('\n')).toContain('Grep');
  });

  test('renders an empty roster with usage guidance', () => {
    const plain = renderAgentRoster([], 0).map(stripAnsi).join('\n');

    expect(plain).toContain('(no sub-agents spawned yet)');
    expect(plain).toContain('Preview pane');
  });

  test('renders roster rows from stable surface state', () => {
    const store = new AgentSurfaceStore();
    const states = store.syncTasks([
      task({ id: 'agent-2', label: 'Second', startedAt: 2_000, state: 'done', finishedAt: 4_000, result: 'ok' }),
      task({ id: 'agent-1', label: 'First', startedAt: 1_000 }),
    ], 3_000);

    expect(states.map(s => s.id)).toEqual(['agent-1', 'agent-2']);
    const plain = renderAgentRoster(states, 0).map(stripAnsi).join('\n');
    expect(plain).toContain('First');
    expect(plain).toContain('working');
    expect(plain).toContain('Second');
    expect(plain).toContain('done');
  });

  test('renders running detail with recent tool trail', () => {
    const state = agentTaskToSurfaceState(task({
      messages: [
        { role: 'assistant', content: [toolUse('Bash', { command: 'bun test' })] },
      ],
    }), { now: 2_000 });

    const plain = stripAnsi(renderAgentDetail(state));
    expect(plain).toContain('Scan repository');
    expect(plain).toContain('working');
    expect(plain).toContain('recent tool calls');
    expect(plain).toContain('Bash');
  });

  test('renders completed detail with captured result and summary', () => {
    const state = agentTaskToSurfaceState(task({
      state: 'done',
      finishedAt: 3_000,
      result: 'Final answer\nDetails',
    }), { now: 3_000 });

    expect(state.summary).toBe('Final answer');
    const plain = stripAnsi(renderAgentDetail(state));
    expect(plain).toContain('done');
    expect(plain).toContain('Final answer');
    expect(plain).toContain('Details');
  });

  test('store prunes removed agents on sync', () => {
    const store = new AgentSurfaceStore();
    store.syncTasks([task({ id: 'agent-1' }), task({ id: 'agent-2' })], 1_000);

    const states = store.syncTasks([task({ id: 'agent-2', state: 'done', finishedAt: 2_000, result: 'ok' })], 2_000);

    expect(states.map(s => s.id)).toEqual(['agent-2']);
    expect(store.get('agent-1')).toBeNull();
    expect(store.get('agent-2')?.status).toBe('done');
  });

  test('store reports semantic changes without elapsed-time noise', () => {
    const store = new AgentSurfaceStore();
    let result = store.syncTasksWithChanges([task({ id: 'agent-1', state: 'running', startedAt: 1_000 })], 2_000);
    expect(result.changes.map(change => change.status)).toEqual(['running']);

    result = store.syncTasksWithChanges([task({ id: 'agent-1', state: 'running', startedAt: 1_000 })], 3_000);
    expect(result.changes).toEqual([]);

    result = store.syncTasksWithChanges([
      task({ id: 'agent-1', state: 'done', startedAt: 1_000, finishedAt: 4_000, result: 'finished' }),
    ], 4_000);
    expect(result.changes).toEqual([expect.objectContaining({ id: 'agent-1', status: 'done' })]);

    result = store.syncTasksWithChanges([], 5_000);
    expect(result.changes).toEqual([{ id: 'agent-1', status: 'removed' }]);
  });
});
