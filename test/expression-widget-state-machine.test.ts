import { describe, expect, test } from 'bun:test';
import {
  INITIAL_SNAPSHOT,
  transition,
  runStateMachine,
  type ModalSessionEvent,
  type ModalSessionSnapshot,
} from '../src/expression/widget/index.js';

describe('expression/widget/state-machine · transitions', () => {
  test('idle + mount → show', () => {
    const next = transition(INITIAL_SNAPSHOT, { kind: 'mount' });
    expect(next?.state).toBe('show');
  });

  test('show + await → awaiting', () => {
    const a = transition(INITIAL_SNAPSHOT, { kind: 'mount' })!;
    const b = transition(a, { kind: 'await' });
    expect(b?.state).toBe('awaiting');
  });

  test('awaiting + answer → answered (with pendingAnswer)', () => {
    const r = runStateMachine([
      { kind: 'mount' },
      { kind: 'await' },
      { kind: 'answer', value: 42 },
    ]);
    expect(r.snapshot.state).toBe('answered');
    expect(r.snapshot.pendingAnswer).toBe(42);
  });

  test('answered + accept → chained · then next → show', () => {
    const r = runStateMachine([
      { kind: 'mount' },
      { kind: 'await' },
      { kind: 'answer', value: 'hi' },
      { kind: 'accept' },
      { kind: 'next' },
    ]);
    expect(r.snapshot.state).toBe('show');
  });

  test('answered + reject → awaiting (with reason)', () => {
    const r = runStateMachine([
      { kind: 'mount' },
      { kind: 'await' },
      { kind: 'answer', value: 'bad' },
      { kind: 'reject', reason: 'pattern mismatch' },
    ]);
    expect(r.snapshot.state).toBe('awaiting');
    expect(r.snapshot.reason).toBe('pattern mismatch');
  });

  test('chained + finish → done', () => {
    const r = runStateMachine([
      { kind: 'mount' },
      { kind: 'await' },
      { kind: 'answer', value: 1 },
      { kind: 'accept' },
      { kind: 'finish' },
    ]);
    expect(r.snapshot.state).toBe('done');
  });

  test('cancel from any non-terminal state', () => {
    const states: Array<ReadonlyArray<ModalSessionEvent>> = [
      [],
      [{ kind: 'mount' }],
      [{ kind: 'mount' }, { kind: 'await' }],
      [{ kind: 'mount' }, { kind: 'await' }, { kind: 'answer', value: 'x' }],
    ];
    for (const seq of states) {
      const a = runStateMachine([...seq, { kind: 'cancel', reason: 'test' }]);
      expect(a.snapshot.state).toBe('cancel');
      expect(a.snapshot.reason).toBe('test');
    }
  });

  test('done is absorbing — further events rejected', () => {
    const finished: ModalSessionSnapshot = { state: 'done' };
    const next = transition(finished, { kind: 'await' });
    expect(next).toBeNull();
  });

  test('cancel is absorbing — re-cancel is idempotent', () => {
    const cancelled: ModalSessionSnapshot = { state: 'cancel', reason: 'a' };
    const next = transition(cancelled, { kind: 'cancel', reason: 'b' });
    expect(next).toEqual(cancelled);
  });

  test('illegal transitions return null without mutating', () => {
    const r = runStateMachine([
      { kind: 'mount' },
      { kind: 'finish' }, // illegal — must accept first
    ]);
    expect(r.rejectedAt).toBe(1);
    expect(r.snapshot.state).toBe('show');
  });
});
