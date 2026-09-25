// ── WR-4 · S3.A · agent-list 4 hook + agent-modal stateless ──
//
// Covers the WR-1+2 opt-in surface for the agent-list widget added in
// the UI Core S3 closure (2026-04-27). Stateless agent-modal is
// asserted to NOT define observation hooks — recorder relies on the
// host default snapshotHash + setState fallback.

import { describe, test, expect } from 'bun:test';
import agentListWidget, { type AgentListState } from '../widgets/agent-list/widget.js';
import agentModalWidget from '../widgets/agent-modal/widget.js';
import type { WidgetContext } from '../src/widgets/types.js';

function listState(overrides: Partial<AgentListState> = {}): AgentListState {
  return {
    agents: [],
    cursor: 0,
    offset: 0,
    ...overrides,
  };
}

const ctx = { character: 'Agents' } as WidgetContext<AgentListState>;

describe('wd-agent-list · WR-4 · describeSurface', () => {
  test('roster size + cursor position projected', () => {
    const fn = agentListWidget.describeSurface!;
    const out = fn(listState({ agents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never, cursor: 2 }), ctx);
    expect(out).toContain('Agents');
    expect(out).toContain('3 agents');
    expect(out).toContain('cursor 2');
  });

  test('help-overlay bit appears when showHelp is true', () => {
    const fn = agentListWidget.describeSurface!;
    const out = fn(listState({ agents: [{ id: 'a' }] as never, showHelp: true }), ctx);
    expect(out).toContain('help-overlay');
  });
});

describe('wd-agent-list · WR-4 · snapshotHash', () => {
  const hash = (s: AgentListState) => agentListWidget.snapshotHash!(s);

  test('cursor change → distinct hash', () => {
    const a = hash(listState({ agents: [{}, {}] as never, cursor: 0 }));
    const b = hash(listState({ agents: [{}, {}] as never, cursor: 1 }));
    expect(a).not.toBe(b);
  });

  test('roster size change → distinct hash', () => {
    const a = hash(listState({ agents: [{}] as never }));
    const b = hash(listState({ agents: [{}, {}] as never }));
    expect(a).not.toBe(b);
  });

  test('hoveredItemIndex change → SAME hash (transient excluded)', () => {
    const a = hash(listState({ agents: [{}, {}] as never, hoveredItemIndex: null }));
    const b = hash(listState({ agents: [{}, {}] as never, hoveredItemIndex: 1 }));
    expect(a).toBe(b);
  });
});

describe('wd-agent-list · WR-4 · onStateChange', () => {
  test('emits agent-list.cursor.change on cursor delta', () => {
    const events: Array<{ kind: string; data: unknown }> = [];
    const tCtx = {
      character: 'Agents',
      telemetry: { emit: (e: { kind: string; data: unknown }) => events.push(e) },
    } as unknown as WidgetContext<AgentListState>;
    const prev = listState({ agents: [{}, {}, {}] as never, cursor: 0 });
    const next = listState({ agents: [{}, {}, {}] as never, cursor: 2 });
    agentListWidget.onStateChange!(prev, next, tCtx);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('agent-list.cursor.change');
    expect(events[0]!.data).toMatchObject({ from: 0, to: 2, total: 3 });
  });

  test('no-op transition emits nothing', () => {
    const events: unknown[] = [];
    const tCtx = {
      character: 'Agents',
      telemetry: { emit: (e: unknown) => events.push(e) },
    } as unknown as WidgetContext<AgentListState>;
    const s = listState({ agents: [{}, {}] as never, cursor: 1 });
    agentListWidget.onStateChange!(s, s, tCtx);
    expect(events).toHaveLength(0);
  });
});

describe('wd-agent-modal · WR-4 stateless', () => {
  test('no onStateChange hook (host default suffices)', () => {
    expect(agentModalWidget.onStateChange).toBeUndefined();
  });

  test('no snapshotHash hook (recorder uses defaultSnapshotHash)', () => {
    expect(agentModalWidget.snapshotHash).toBeUndefined();
  });

  test('no describeSurface hook (DescribeSurface tool returns generic preview)', () => {
    expect(agentModalWidget.describeSurface).toBeUndefined();
  });
});
