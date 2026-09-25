// Unit tests for ACP tool-call state table — H1 #3.
//
// Injected `now` stays deterministic so endedAt comparisons work.

import { describe, expect, test } from 'bun:test';
import {
  createToolCallTable,
  toolCallGlyph,
  toolCallLabel,
  type ToolCallState,
} from '../src/acp/tool-call-state.js';
import type { ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk';

function wireToolCall(partial: Partial<ToolCall> & Pick<ToolCall, 'toolCallId' | 'title'>): ToolCall {
  return partial as ToolCall;
}

function wireUpdate(partial: Partial<ToolCallUpdate> & Pick<ToolCallUpdate, 'toolCallId'>): ToolCallUpdate {
  return partial as ToolCallUpdate;
}

describe('createToolCallTable · createFromWire', () => {
  test('undefined status becomes pending', () => {
    const t = createToolCallTable();
    const rec = t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'Read' }));
    expect(rec.state).toBe('pending');
    expect(rec.id).toBe('a');
    expect(rec.title).toBe('Read');
    expect(rec.endedAt).toBeUndefined();
  });

  test('in_progress status maps through', () => {
    const t = createToolCallTable();
    const rec = t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'Run', status: 'in_progress' }));
    expect(rec.state).toBe('in_progress');
  });

  test('kind + rawInput propagate', () => {
    const t = createToolCallTable();
    const rec = t.createFromWire(wireToolCall({
      toolCallId: 'a', title: 'Read', kind: 'read', rawInput: { path: '/tmp/foo' },
    }));
    expect(rec.kind).toBe('read');
    expect(rec.rawInput).toEqual({ path: '/tmp/foo' });
  });

  test('terminal status on creation sets endedAt', () => {
    let n = 1000;
    const t = createToolCallTable({ now: () => n++ });
    const rec = t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X', status: 'completed' }));
    expect(rec.state).toBe('completed');
    expect(rec.endedAt).toBe(rec.startedAt);
  });
});

describe('createToolCallTable · applyUpdate', () => {
  test('unknown id returns null', () => {
    const t = createToolCallTable();
    expect(t.applyUpdate(wireUpdate({ toolCallId: 'ghost', status: 'completed' }))).toBeNull();
  });

  test('title-only update patches title', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'Read' }));
    const rec = t.applyUpdate(wireUpdate({ toolCallId: 'a', title: 'Read file' }));
    expect(rec?.title).toBe('Read file');
    expect(rec?.state).toBe('pending');
  });

  test('in_progress → completed is legal + stamps endedAt', () => {
    let n = 1000;
    const t = createToolCallTable({ now: () => n++ });
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X', status: 'in_progress' }));
    const rec = t.applyUpdate(wireUpdate({ toolCallId: 'a', status: 'completed' }));
    expect(rec?.state).toBe('completed');
    expect(rec?.endedAt).toBeDefined();
    expect(rec?.endedAt).toBeGreaterThan(rec!.startedAt);
  });

  test('illegal transition (completed → in_progress) is rejected · state stays', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X', status: 'completed' }));
    const rec = t.applyUpdate(wireUpdate({ toolCallId: 'a', status: 'in_progress' }));
    // applyUpdate still returns the record — transition was a no-op.
    expect(rec?.state).toBe('completed');
  });

  test('applyUpdate preserves rawOutput from update', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X' }));
    const rec = t.applyUpdate(wireUpdate({ toolCallId: 'a', rawOutput: { ok: true } }));
    expect(rec?.rawOutput).toEqual({ ok: true });
  });
});

describe('createToolCallTable · HITL lifecycle marks', () => {
  test('markWaitingForConfirmation from pending is legal', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X' }));
    const rec = t.markWaitingForConfirmation('a');
    expect(rec?.state).toBe('waiting_for_confirmation');
  });

  test('markWaitingForConfirmation from terminal (completed) is a no-op', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X', status: 'completed' }));
    const rec = t.markWaitingForConfirmation('a');
    expect(rec).toBeNull();
    expect(t.get('a')?.state).toBe('completed');
  });

  test('markRejected from waiting_for_confirmation is legal', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X' }));
    t.markWaitingForConfirmation('a');
    const rec = t.markRejected('a');
    expect(rec?.state).toBe('rejected');
  });

  test('markRejected from pending is not legal (must go through waiting)', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X' }));
    const rec = t.markRejected('a');
    expect(rec).toBeNull();
    expect(t.get('a')?.state).toBe('pending');
  });

  test('markCanceledAll flips non-terminal records', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X', status: 'in_progress' }));
    t.createFromWire(wireToolCall({ toolCallId: 'b', title: 'Y', status: 'pending' }));
    t.createFromWire(wireToolCall({ toolCallId: 'c', title: 'Z', status: 'completed' }));
    const flipped = t.markCanceledAll();
    expect(flipped.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(t.get('a')?.state).toBe('canceled');
    expect(t.get('b')?.state).toBe('canceled');
    expect(t.get('c')?.state).toBe('completed'); // terminal, untouched
  });

  test('markWaitingForConfirmation on unknown id returns null', () => {
    const t = createToolCallTable();
    expect(t.markWaitingForConfirmation('ghost')).toBeNull();
    expect(t.markRejected('ghost')).toBeNull();
  });
});

describe('createToolCallTable · canTransition', () => {
  test('rejects self-transitions', () => {
    const t = createToolCallTable();
    expect(t.canTransition('pending', 'pending')).toBe(false);
  });

  test('rejects from-terminal transitions', () => {
    const t = createToolCallTable();
    expect(t.canTransition('completed', 'in_progress')).toBe(false);
    expect(t.canTransition('failed', 'completed')).toBe(false);
    expect(t.canTransition('rejected', 'pending')).toBe(false);
    expect(t.canTransition('canceled', 'in_progress')).toBe(false);
  });

  test('accepts valid forward transitions', () => {
    const t = createToolCallTable();
    expect(t.canTransition('pending', 'in_progress')).toBe(true);
    expect(t.canTransition('pending', 'waiting_for_confirmation')).toBe(true);
    expect(t.canTransition('in_progress', 'completed')).toBe(true);
    expect(t.canTransition('in_progress', 'failed')).toBe(true);
    expect(t.canTransition('waiting_for_confirmation', 'rejected')).toBe(true);
  });

  test('rejects skips that bypass lifecycle', () => {
    const t = createToolCallTable();
    // Cannot skip in_progress from waiting_for_confirmation to completed
    // without passing through in_progress (protocol invariant).
    expect(t.canTransition('waiting_for_confirmation', 'completed')).toBe(false);
  });
});

describe('createToolCallTable · list / clear / concurrent', () => {
  test('concurrent tool calls are tracked independently', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'Read' }));
    t.createFromWire(wireToolCall({ toolCallId: 'b', title: 'Write' }));
    t.createFromWire(wireToolCall({ toolCallId: 'c', title: 'Exec' }));
    expect(t.list().map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    t.applyUpdate(wireUpdate({ toolCallId: 'a', status: 'completed' }));
    t.applyUpdate(wireUpdate({ toolCallId: 'b', status: 'failed' }));
    expect(t.get('a')?.state).toBe('completed');
    expect(t.get('b')?.state).toBe('failed');
    expect(t.get('c')?.state).toBe('pending');
  });

  test('clear empties the table', () => {
    const t = createToolCallTable();
    t.createFromWire(wireToolCall({ toolCallId: 'a', title: 'X' }));
    t.clear();
    expect(t.list()).toEqual([]);
    expect(t.get('a')).toBeNull();
  });
});

describe('toolCallGlyph / toolCallLabel', () => {
  test('every state has a distinct glyph', () => {
    const states: ToolCallState[] = [
      'pending',
      'waiting_for_confirmation',
      'in_progress',
      'completed',
      'failed',
      'rejected',
      'canceled',
    ];
    const glyphs = new Set(states.map(toolCallGlyph));
    expect(glyphs.size).toBe(states.length);
  });

  test('every state has a human label', () => {
    const states: ToolCallState[] = [
      'pending',
      'waiting_for_confirmation',
      'in_progress',
      'completed',
      'failed',
      'rejected',
      'canceled',
    ];
    for (const s of states) {
      expect(toolCallLabel(s).length).toBeGreaterThan(0);
    }
  });
});
