// H4 Phase 3.B.2b · codex-app-server-events.ts translator unit tests.
//
// Drives each translator function with crafted v2 notification params
// and asserts the emitted SessionUpdate shape. No agent instance,
// no client, no disk I/O — pure functions + EventState.

import { describe, test, expect } from 'bun:test';
import {
  createEventState,
  REASONING_META_KEY,
  TRACKED_NOTIFICATION_METHODS,
  translateAgentMessageDelta,
  translateCommandExecutionOutputDelta,
  translateFileChangeOutputDelta,
  translateItemNotification,
  translatePlanDelta,
  translateReasoningDelta,
  translateTurnCompleted,
  translateTurnPlanUpdated,
} from '../src/acp/codex-app-server-events.js';

describe('TRACKED_NOTIFICATION_METHODS', () => {
  test('includes all v2 methods the agent dispatches on', () => {
    // Guard against accidental removal · this is the contract between
    // codex-app-server-agent.ts and codex-app-server-events.ts.
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/started');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/completed');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/agentMessage/delta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/plan/delta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/reasoning/summaryTextDelta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/reasoning/textDelta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/commandExecution/outputDelta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('item/fileChange/outputDelta');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('turn/plan/updated');
    expect(TRACKED_NOTIFICATION_METHODS).toContain('turn/completed');
  });
});

describe('translateAgentMessageDelta', () => {
  test('emits agent_message_chunk with the delta text', () => {
    const updates = translateAgentMessageDelta({ threadId: 'tid', turnId: 'turn1', itemId: 'i1', delta: 'hi ' });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi ' },
    } as unknown as typeof updates[0]);
  });

  test('empty delta → no update', () => {
    expect(translateAgentMessageDelta({ delta: '' })).toEqual([]);
    expect(translateAgentMessageDelta({})).toEqual([]);
    expect(translateAgentMessageDelta(undefined)).toEqual([]);
  });
});

describe('translatePlanDelta / translateReasoningDelta', () => {
  test('both emit agent_thought_chunk with REASONING_META_KEY', () => {
    const pd = translatePlanDelta({ delta: 'plan text' });
    expect(pd).toHaveLength(1);
    expect((pd[0] as any).sessionUpdate).toBe('agent_thought_chunk');
    expect((pd[0] as any)._meta[REASONING_META_KEY]).toBe(true);

    const rd = translateReasoningDelta({ delta: 'reasoning text' });
    expect(rd).toHaveLength(1);
    expect((rd[0] as any).sessionUpdate).toBe('agent_thought_chunk');
    expect((rd[0] as any)._meta[REASONING_META_KEY]).toBe(true);
  });
});

describe('translateItemNotification · agentMessage', () => {
  test('item.started emits nothing (delta notifications own the stream)', () => {
    const s = createEventState();
    const u = translateItemNotification('started', {
      item: { type: 'agentMessage', id: 'i1' },
      threadId: 'tid',
      turnId: 't1',
    }, s);
    expect(u).toEqual([]);
  });

  test('item.completed also emits nothing', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: { type: 'agentMessage', id: 'i1', text: 'hello world' },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toEqual([]);
  });
});

describe('translateItemNotification · commandExecution', () => {
  test('started → tool_call with kind=execute + in_progress + empty content', () => {
    const s = createEventState();
    const u = translateItemNotification('started', {
      item: {
        type: 'commandExecution', id: 'c1',
        command: 'ls -la /tmp', cwd: '/tmp', status: 'inProgress',
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call');
    expect(uu.toolCallId).toBe('c1');
    expect(uu.kind).toBe('execute');
    expect(uu.status).toBe('in_progress');
    expect(uu.title).toContain('ls -la');
    expect(uu.content).toEqual([]);
    expect(uu.rawInput).toMatchObject({ command: 'ls -la /tmp', cwd: '/tmp' });
    expect(s.items.get('c1')!.startedEmitted).toBe(true);
  });

  test('outputDelta accumulates + emits tool_call_update', () => {
    const s = createEventState();
    // Seed item.started so delta has a tool_call to update
    translateItemNotification('started', {
      item: { type: 'commandExecution', id: 'c1', command: 'ls', cwd: '/tmp' },
      threadId: 'tid', turnId: 't1',
    }, s);
    const u1 = translateCommandExecutionOutputDelta({ itemId: 'c1', delta: 'abc' }, s);
    const u2 = translateCommandExecutionOutputDelta({ itemId: 'c1', delta: 'def' }, s);
    expect(u1).toHaveLength(1);
    expect((u1[0] as any).content[0].content.text).toBe('abc');
    expect((u2[0] as any).content[0].content.text).toBe('abcdef');
  });

  test('outputDelta before item.started is stashed silently (no update)', () => {
    const s = createEventState();
    const u = translateCommandExecutionOutputDelta({ itemId: 'orphan', delta: 'x' }, s);
    expect(u).toEqual([]);
    // Delta is still buffered · later item.started can still use it.
    expect(s.items.get('orphan')!.outputBuffer).toBe('x');
  });

  test('completed → tool_call_update with final exit_code + duration_ms', () => {
    const s = createEventState();
    translateItemNotification('started', {
      item: { type: 'commandExecution', id: 'c1', command: 'ls' },
      threadId: 'tid', turnId: 't1',
    }, s);
    const u = translateItemNotification('completed', {
      item: {
        type: 'commandExecution', id: 'c1',
        command: 'ls', status: 'completed',
        aggregatedOutput: 'final output text',
        exitCode: 0, durationMs: 123,
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call_update');
    expect(uu.toolCallId).toBe('c1');
    expect(uu.status).toBe('completed');
    expect(uu.content[0].content.text).toBe('final output text');
    expect(uu.rawOutput).toEqual({ exit_code: 0, duration_ms: 123 });
  });

  test('output buffer truncation at cap', () => {
    const s = createEventState({ outputBufferBytes: 10 });
    translateItemNotification('started', {
      item: { type: 'commandExecution', id: 'c1', command: 'ls' },
      threadId: 'tid', turnId: 't1',
    }, s);
    const u = translateCommandExecutionOutputDelta({ itemId: 'c1', delta: 'ABCDEFGHIJKL' }, s);
    const txt = (u[0] as any).content[0].content.text as string;
    expect(txt).toContain('truncated');
    expect(s.items.get('c1')!.outputTruncated).toBe(true);
  });
});

describe('translateItemNotification · fileChange', () => {
  test('started → no emit · only completed emits tool_call edit', () => {
    const s = createEventState();
    const u = translateItemNotification('started', {
      item: { type: 'fileChange', id: 'f1', changes: [], status: 'inProgress' },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toEqual([]);
  });

  test('completed → tool_call with kind=edit + path list + rawInput.changes', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: {
        type: 'fileChange', id: 'f1', status: 'completed',
        changes: [
          { kind: 'modify', path: '/repo/a.ts' },
          { kind: 'create', path: '/repo/b.ts' },
        ],
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call');
    expect(uu.kind).toBe('edit');
    expect(uu.status).toBe('completed');
    expect(uu.title).toBe('2 file change(s)');
    expect(uu.content[0].content.text).toContain('/repo/a.ts');
    expect(uu.rawInput.changes).toHaveLength(2);
  });

  test('fileChange outputDelta before started stashes silently', () => {
    const s = createEventState();
    const u = translateFileChangeOutputDelta({ itemId: 'f1', delta: 'diff content' }, s);
    expect(u).toEqual([]);
  });
});

describe('translateItemNotification · reasoning', () => {
  test('started emits nothing · completed joins summary + content as agent_thought_chunk', () => {
    const s = createEventState();
    expect(
      translateItemNotification('started', {
        item: { type: 'reasoning', id: 'r1' },
        threadId: 'tid', turnId: 't1',
      }, s),
    ).toEqual([]);
    const u = translateItemNotification('completed', {
      item: {
        type: 'reasoning', id: 'r1',
        summary: ['thought A', 'thought B'],
        content: ['deep thought'],
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('agent_thought_chunk');
    expect(uu.content.text).toBe('thought A\nthought B\ndeep thought');
    expect(uu._meta[REASONING_META_KEY]).toBe(true);
  });

  test('empty reasoning → no emit', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: { type: 'reasoning', id: 'r2', summary: [], content: [] },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toEqual([]);
  });
});

describe('translateItemNotification · mcpToolCall', () => {
  test('started → tool_call · other kind · title = server:tool', () => {
    const s = createEventState();
    const u = translateItemNotification('started', {
      item: {
        type: 'mcpToolCall', id: 'm1',
        server: 'srv', tool: 'do-thing',
        status: 'inProgress', arguments: { x: 1 },
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call');
    expect(uu.kind).toBe('other');
    expect(uu.title).toBe('srv:do-thing');
    expect(uu.rawInput).toEqual({ x: 1 });
  });

  test('completed → tool_call_update with result', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: {
        type: 'mcpToolCall', id: 'm1',
        server: 'srv', tool: 'do-thing',
        status: 'completed',
        result: { ok: true },
      },
      threadId: 'tid', turnId: 't1',
    }, s);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call_update');
    expect(uu.rawOutput).toEqual({ ok: true });
  });
});

describe('translateItemNotification · webSearch', () => {
  test('started → tool_call · search kind · query title', () => {
    const s = createEventState();
    const u = translateItemNotification('started', {
      item: { type: 'webSearch', id: 'w1', query: 'how to build a rust compiler' },
      threadId: 'tid', turnId: 't1',
    }, s);
    const uu = u[0] as any;
    expect(uu.kind).toBe('search');
    expect(uu.title).toContain('search: how to');
  });

  test('completed → tool_call_update · status=completed', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: { type: 'webSearch', id: 'w1', query: 'x', action: { kind: 'none' } },
      threadId: 'tid', turnId: 't1',
    }, s);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('tool_call_update');
    expect(uu.status).toBe('completed');
  });
});

describe('translateItemNotification · plan item + unknown variants', () => {
  test('plan item.completed emits agent_thought_chunk', () => {
    const s = createEventState();
    const u = translateItemNotification('completed', {
      item: { type: 'plan', id: 'p1', text: 'Phase 1 · research the problem' },
      threadId: 'tid', turnId: 't1',
    }, s);
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('agent_thought_chunk');
    expect(uu.content.text).toContain('[plan]');
    expect(uu._meta[REASONING_META_KEY]).toBe(true);
  });

  test('unknown variant (imageGeneration etc.) drops silently', () => {
    const s = createEventState();
    expect(
      translateItemNotification('completed', {
        item: { type: 'imageGeneration', id: 'ig1', status: 'completed', result: '...' },
        threadId: 'tid', turnId: 't1',
      }, s),
    ).toEqual([]);
  });

  test('malformed params (no item) drops silently', () => {
    const s = createEventState();
    expect(translateItemNotification('started', { threadId: 'tid' }, s)).toEqual([]);
    expect(translateItemNotification('started', null, s)).toEqual([]);
  });
});

describe('translateTurnPlanUpdated', () => {
  test('maps plan steps to ACP plan SessionUpdate', () => {
    const u = translateTurnPlanUpdated({
      threadId: 'tid', turnId: 't1', explanation: null,
      plan: [
        { text: 'Step 1', status: 'completed' },
        { text: 'Step 2', status: 'inProgress' },
        { text: 'Step 3', status: 'pending' },
      ],
    });
    expect(u).toHaveLength(1);
    const uu = u[0] as any;
    expect(uu.sessionUpdate).toBe('plan');
    expect(uu.entries).toHaveLength(3);
    expect(uu.entries[0]).toMatchObject({ content: 'Step 1', status: 'completed' });
    expect(uu.entries[1]).toMatchObject({ content: 'Step 2', status: 'in_progress' });
    expect(uu.entries[2]).toMatchObject({ content: 'Step 3', status: 'pending' });
  });

  test('empty plan → no emit', () => {
    expect(translateTurnPlanUpdated({ plan: [] })).toEqual([]);
  });
});

describe('translateTurnCompleted', () => {
  test('turn.status=completed → end_turn', () => {
    expect(translateTurnCompleted({ threadId: 'tid', turn: { status: 'completed' } })).toEqual({
      stopReason: 'end_turn',
    });
  });

  test('turn.status=interrupted → cancelled', () => {
    expect(translateTurnCompleted({ threadId: 'tid', turn: { status: 'interrupted' } })).toEqual({
      stopReason: 'cancelled',
    });
  });

  test('turn.status=failed → end_turn with errorMessage', () => {
    const r = translateTurnCompleted({
      threadId: 'tid',
      turn: { status: 'failed', error: { message: 'bang' } },
    });
    expect(r.stopReason).toBe('end_turn');
    expect(r.errorMessage).toBe('bang');
  });

  test('malformed → end_turn default', () => {
    expect(translateTurnCompleted({})).toEqual({ stopReason: 'end_turn' });
    expect(translateTurnCompleted(undefined)).toEqual({ stopReason: 'end_turn' });
  });
});
