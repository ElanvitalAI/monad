import { describe, expect, test } from 'bun:test';
import agentListWidget, { type AgentListState } from '../widgets/agent-list/widget.js';
import agentDetailWidget from '../widgets/agent-detail/widget.js';
import agentModalWidget from '../widgets/agent-modal/widget.js';
import type { AgentSurfaceState } from '../src/display/index.js';
import { stripAnsi } from '../src/tui.js';

const ctx = (overrides: Partial<{ width: number; height: number; focused: boolean }> = {}) => ({
  width: overrides.width ?? 72,
  height: overrides.height ?? 8,
  focused: overrides.focused ?? true,
});

function agent(overrides: Partial<AgentSurfaceState> = {}): AgentSurfaceState {
  return {
    id: 'agent-1',
    name: 'Scan repository',
    definitionName: 'default',
    status: 'running',
    elapsedMs: 1200,
    toolCount: 2,
    log: [
      { level: 'tool', text: '  Bash {"command":"bun test"}' },
    ],
    updatedAt: 2000,
    ...overrides,
  };
}

describe('agent-list widget', () => {
  test('renders empty guidance and pads to height', () => {
    const state = agentListWidget.initialState();
    const out = agentListWidget.render(state, ctx({ height: 6 }), 'Agents');
    const plain = out.map(stripAnsi).join('\n');

    expect(out).toHaveLength(6);
    expect(plain).toContain('Agents');
    expect(plain).toContain('no sub-agents spawned yet');
  });

  test('renders agent rows and keeps cursor in bounds', () => {
    // Phase 7 Batch B (2026-04-20): agent-list scroll keys moved to the
    // Cursorable behavior; onKey keeps only enter (submit). Dispatch
    // through the behavior to verify cursor clamping.
    const state = agentListWidget.initialState({
      agents: [
        agent({ id: 'a1', name: 'First' }),
        agent({ id: 'a2', name: 'Second', status: 'done', result: 'ok' }),
      ],
    });
    const cursor = agentListWidget.behaviors!.find((b) => b.name === 'cursorable');
    expect(cursor).toBeDefined();
    cursor!.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    cursor!.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);

    expect(state.cursor).toBe(1);
    const plain = agentListWidget.render(state, ctx(), 'Agents').map(stripAnsi).join('\n');
    expect(plain).toContain('First');
    expect(plain).toContain('Second');
    expect(plain).toContain('done');
  });

  test('enter submits a stable agent id', () => {
    const state: AgentListState = agentListWidget.initialState({
      agents: [agent({ id: 'agent-x' })],
    });

    expect(agentListWidget.onKey!({ name: 'enter' }, state, {} as any))
      .toEqual({ type: 'submit', text: 'agent:agent-x' });
  });

  test('Cursorable behavior G jumps to last, g resets to 0', () => {
    // Phase 7 Batch B — verify the getItemCount injector drives
    // clamping so cursor can't exceed agents.length - 1 even after
    // dozens of j's, and G lands on the last index.
    const state: AgentListState = agentListWidget.initialState({
      agents: [
        agent({ id: 'a1' }),
        agent({ id: 'a2' }),
        agent({ id: 'a3' }),
      ],
    });
    const cursor = agentListWidget.behaviors!.find((b) => b.name === 'cursorable')!;

    cursor.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(2);
    cursor.onKey!({ name: 'g', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(0);

    for (let i = 0; i < 10; i++) {
      cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    }
    expect(state.cursor).toBe(2);
  });

  test('Cursorable is a no-op on an empty roster', () => {
    const state: AgentListState = agentListWidget.initialState();
    const cursor = agentListWidget.behaviors!.find((b) => b.name === 'cursorable')!;
    cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    cursor.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(0);
  });
});

describe('agent-detail widget', () => {
  test('renders selected running agent detail', () => {
    const state = agentDetailWidget.initialState({ agent: agent() });
    const plain = agentDetailWidget.render(state, ctx(), 'Agent Detail').map(stripAnsi).join('\n');

    expect(plain).toContain('Agent Detail');
    expect(plain).toContain('Scan repository');
    expect(plain).toContain('working');
    expect(plain).toContain('Bash');
  });

  test('renders final result and scroll keys mutate scroll', () => {
    // Phase 3a (2026-04-20): agent-detail no longer has its own onKey.
    // Scroll keys are handled by the Scrollable behavior declared in
    // `agentDetailWidget.behaviors`. Dispatch through the first
    // matching behavior to verify the scroll-on-PgDn path.
    const state = agentDetailWidget.initialState({
      agent: agent({
        status: 'done',
        result: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
      }),
    });
    const behaviors = agentDetailWidget.behaviors ?? [];
    const scroll = behaviors.find((b) => b.name === 'scrollable');
    expect(scroll).toBeDefined();
    scroll!.onKey!(
      { name: 'pagedown', ctrl: false, shift: false } as never,
      state as never,
      {} as never,
    );
    agentDetailWidget.render(state, ctx({ height: 5 }), 'Agent Detail');

    expect(state.scroll).toBeGreaterThan(0);
  });

  test('onMouse scroll wheel mutates scroll', () => {
    const state = agentDetailWidget.initialState({
      agent: agent({
        status: 'done',
        result: Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n'),
      }),
    });
    agentDetailWidget.render(state, ctx({ height: 5 }), 'Agent Detail');
    expect(agentDetailWidget.onMouse!({ type: 'scroll-down', row: 2, col: 0 }, state, {} as never))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(1);
    expect(agentDetailWidget.onMouse!({ type: 'scroll-up', row: 2, col: 0 }, state, {} as never))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(0);
  });
});

describe('agent-modal widget', () => {
  test('renders detail without a pane title and keeps a footer row', () => {
    const state = agentModalWidget.initialState({ agent: agent({ result: 'done text', status: 'done' }) });
    const out = agentModalWidget.render(state, ctx({ height: 5 }), 'Agent');
    const plain = out.map(stripAnsi).join('\n');

    expect(out).toHaveLength(5);
    expect(plain).toContain('Scan repository');
    expect(plain).toContain('j/k scroll');
  });

  test('onMouse scroll wheel mutates scroll', () => {
    const state = agentModalWidget.initialState({
      agent: agent({
        result: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
        status: 'done',
      }),
    });
    expect(agentModalWidget.onMouse!({ type: 'scroll-down', row: 2, col: 0 }, state, {} as any))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(1);
    expect(agentModalWidget.onMouse!({ type: 'scroll-up', row: 2, col: 0 }, state, {} as any))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(0);
  });
});
