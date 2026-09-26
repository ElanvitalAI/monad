// W5 U4 · PatcherBridge buffer + classify hint + subscriber fan-out.

import { describe, expect, test } from 'bun:test';
import {
  PatcherBridge,
  classifyForPatcher,
  type PatcherBridgeInput,
} from '../../src/user-intent/sinks/patcher-bridge';
import type { UserIntentEvent, UserIntentLayer } from '../../src/user-intent/types';

function ev(layer: UserIntentLayer, kind = `${layer}.x`): UserIntentEvent {
  return {
    schema_version: 1,
    event_id: `${layer}-${Math.random().toString(36).slice(2, 8)}`,
    ts: '2026-05-12T00:00:00.000Z',
    user_id: '',
    session_id: '',
    device_id: 'test',
    elanous_id: 'm',
    surface: 'tui',
    intent: { layer, kind },
  } as UserIntentEvent;
}

describe('classifyForPatcher', () => {
  test('maps each layer to coarse card kind hint', () => {
    expect(classifyForPatcher('utterance')).toBe('utterance');
    expect(classifyForPatcher('gesture')).toBe('interaction');
    expect(classifyForPatcher('navigation')).toBe('interaction');
    expect(classifyForPatcher('selection')).toBe('interaction');
    expect(classifyForPatcher('ambient')).toBe('context-signal');
    expect(classifyForPatcher('device_state')).toBe('context-signal');
    expect(classifyForPatcher('system')).toBe('system-event');
  });
});

describe('PatcherBridge', () => {
  test('asSink returns a UserIntentSink named patcher-bridge', () => {
    const b = new PatcherBridge();
    const sink = b.asSink();
    expect(sink.name).toBe('patcher-bridge');
    sink.write(ev('utterance'));
    expect(b.pendingCount()).toBe(1);
  });

  test('enqueue attaches cardKindHint', () => {
    const b = new PatcherBridge();
    b.enqueue(ev('gesture'));
    b.enqueue(ev('utterance'));
    const batch = b.drainBatch();
    expect(batch[0]!.cardKindHint).toBe('interaction');
    expect(batch[1]!.cardKindHint).toBe('utterance');
  });

  test('batchSize triggers subscriber flush', () => {
    const b = new PatcherBridge({ batchSize: 3 });
    const seen: PatcherBridgeInput[][] = [];
    b.subscribe((batch) => seen.push(batch));
    b.enqueue(ev('utterance'));
    b.enqueue(ev('utterance'));
    expect(seen.length).toBe(0);
    b.enqueue(ev('utterance'));
    expect(seen.length).toBe(1);
    expect(seen[0]!.length).toBe(3);
    expect(b.pendingCount()).toBe(0);
  });

  test('capacity evicts oldest', () => {
    const b = new PatcherBridge({ batchSize: 100, capacity: 5 });
    for (let i = 0; i < 10; i++) {
      b.enqueue({ ...ev('utterance'), event_id: `e${i}` } as UserIntentEvent);
    }
    expect(b.pendingCount()).toBe(5);
    const batch = b.drainBatch();
    expect(batch[0]!.event.event_id).toBe('e5');
    expect(batch[4]!.event.event_id).toBe('e9');
  });

  test('subscribe returns unsubscribe', () => {
    const b = new PatcherBridge({ batchSize: 1 });
    let calls = 0;
    const off = b.subscribe(() => { calls++; });
    b.enqueue(ev('utterance'));
    off();
    b.enqueue(ev('utterance'));
    expect(calls).toBe(1);
  });

  test('subscriber throw does not break logger contract', () => {
    const b = new PatcherBridge({ batchSize: 1 });
    b.subscribe(() => { throw new Error('boom'); });
    expect(() => b.enqueue(ev('utterance'))).not.toThrow();
  });

  test('flush with no subscribers retains queue for polling drain', () => {
    const b = new PatcherBridge({ batchSize: 1 });
    b.enqueue(ev('utterance'));
    b.flush();
    expect(b.pendingCount()).toBe(1);
    expect(b.drainBatch().length).toBe(1);
  });
});
