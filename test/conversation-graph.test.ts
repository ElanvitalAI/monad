import { describe, expect, test } from 'bun:test';
import { createConversationGraphStore } from '../src/studio/conversation-graph.js';

describe('conversation-graph store', () => {
  test('recordEdge appends interaction events in insertion order', () => {
    const store = createConversationGraphStore();
    const a = store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 's1', messageId: 'm1' },
      to: { sessionId: 's2', messageId: 'm2' },
      kind: 'handoff',
      now: () => 10,
    });
    const b = store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 's2', messageId: 'm2' },
      to: { sessionId: 's3', messageId: 'm3' },
      kind: 'reply',
      now: () => 20,
    });
    expect(store.listEdges()).toEqual([a, b]);
  });

  test('listEdges filters by workspace, session, and kind', () => {
    const store = createConversationGraphStore();
    store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 's1' },
      to: { sessionId: 's2' },
      kind: 'handoff',
    });
    store.recordEdge({
      workspaceId: 'ws-b',
      from: { sessionId: 's2' },
      to: { sessionId: 's3' },
      kind: 'pin',
      payloadRef: 'card-1',
    });
    expect(store.listEdges({ workspaceId: 'ws-a' })).toHaveLength(1);
    expect(store.listEdges({ sessionId: 's2' })).toHaveLength(2);
    expect(store.listEdges({ kind: 'pin' }).map((edge) => edge.payloadRef)).toEqual(['card-1']);
  });

  test('summarizeWorkspace builds projection without becoming source of truth', () => {
    const store = createConversationGraphStore();
    store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 'alpha', messageId: 'm1' },
      to: { sessionId: 'beta', messageId: 'm2' },
      kind: 'reply',
      now: () => 100,
    });
    store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 'beta', messageId: 'm3' },
      to: { sessionId: 'beta', messageId: 'm3' },
      kind: 'pin',
      payloadRef: 'card-42',
      now: () => 200,
    });
    const summary = store.summarizeWorkspace('ws-a');
    expect(summary.workspaceId).toBe('ws-a');
    expect(summary.totalEdges).toBe(2);
    expect(summary.pinCount).toBe(1);
    expect(summary.lastEventAt).toBe(200);
    expect(summary.participants).toEqual(['alpha', 'beta']);
    expect(summary.kindCounts.reply).toBe(1);
    expect(summary.kindCounts.pin).toBe(1);
  });

  test('listWorkspaceIds returns sorted unique ids', () => {
    const store = createConversationGraphStore();
    store.recordEdge({
      workspaceId: 'ws-b',
      from: { sessionId: 's1' },
      to: { sessionId: 's2' },
      kind: 'fork',
    });
    store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 's2' },
      to: { sessionId: 's3' },
      kind: 'merge',
    });
    store.recordEdge({
      workspaceId: 'ws-b',
      from: { sessionId: 's3' },
      to: { sessionId: 's4' },
      kind: 'pin',
    });
    expect(store.listWorkspaceIds()).toEqual(['ws-a', 'ws-b']);
  });

  test('reset clears append-only memory for test reuse', () => {
    const store = createConversationGraphStore();
    store.recordEdge({
      workspaceId: 'ws-a',
      from: { sessionId: 's1' },
      to: { sessionId: 's2' },
      kind: 'inject',
    });
    store.reset();
    expect(store.listEdges()).toHaveLength(0);
    expect(store.listWorkspaceIds()).toHaveLength(0);
  });
});
