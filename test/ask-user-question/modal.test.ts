import { describe, expect, test } from 'bun:test';
import { createAskUserQuestionModal, type AskUserQuestionRequest } from '../../src/ask-user-question/index.js';
import type { KeyEvent } from '../../src/display/types.js';

const BOUNDS = { row: 3, col: 3, width: 60, height: 16 };

function mkRequest(
  overrides: Partial<AskUserQuestionRequest['questions'][number]>[] = [{}],
): AskUserQuestionRequest {
  return {
    questions: overrides.map((o, i) => ({
      id: (o as any).id ?? `q${i}`,
      header: (o as any).header ?? `H${i}`,
      question: (o as any).question ?? `Question ${i}?`,
      options: (o as any).options ?? [
        { label: 'A', description: 'first' },
        { label: 'B', description: 'second' },
      ],
      multiSelect: (o as any).multiSelect,
      includeOther: (o as any).includeOther,
    })),
  };
}

function key(name: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, ...extra } as KeyEvent;
}

describe('createAskUserQuestionModal — single-select', () => {
  test('1 / Enter / arrow key select → result.answers has the label', async () => {
    const modal = createAskUserQuestionModal({ id: 't1', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('1'));
    const result = await modal.promise;
    expect(result.answers.q0).toBe('A');
    expect(result.cancelled).toBeUndefined();
  });

  test('Enter with cursor moved via ↓ picks second option', async () => {
    const modal = createAskUserQuestionModal({ id: 't2', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('down'));
    modal.handleKey(key('return'));
    const r = await modal.promise;
    expect(r.answers.q0).toBe('B');
  });

  test('↑ wraps around at the top', async () => {
    const modal = createAskUserQuestionModal({ id: 't3', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('up'));  // wraps to last = Other (includeOther default true)
    modal.handleKey(key('space'));  // open Other input
    // Type "foo"
    modal.handleKey(key('f', { sequence: 'f' } as any));
    modal.handleKey(key('o', { sequence: 'o' } as any));
    modal.handleKey(key('o', { sequence: 'o' } as any));
    modal.handleKey(key('return'));
    const r = await modal.promise;
    expect(r.answers.q0).toBe('Other');
    expect(r.otherText?.q0).toBe('foo');
  });
});

describe('createAskUserQuestionModal — multi-select', () => {
  test('Space toggles; Enter submits array', async () => {
    const modal = createAskUserQuestionModal({
      id: 'm1', bounds: BOUNDS,
      request: mkRequest([{ multiSelect: true }]),
    });
    modal.handleKey(key('space'));          // toggle cursor=0 (A)
    modal.handleKey(key('down'));           // cursor=1 (B)
    modal.handleKey(key('space'));          // toggle B
    modal.handleKey(key('return'));
    const r = await modal.promise;
    expect(Array.isArray(r.answers.m1 ?? r.answers.q0)).toBe(true);
    const answer = r.answers.q0 as string[];
    expect(answer).toContain('A');
    expect(answer).toContain('B');
  });

  test('Enter without any selection is ignored', async () => {
    const modal = createAskUserQuestionModal({
      id: 'm2', bounds: BOUNDS,
      request: mkRequest([{ multiSelect: true }]),
    });
    modal.handleKey(key('return'));  // should be swallowed
    // Cancel to resolve so the test doesn't hang.
    modal.handleKey(key('escape'));
    const r = await modal.promise;
    expect(r.cancelled).toBe(true);
  });
});

describe('createAskUserQuestionModal — Other free-form', () => {
  test('picking Other opens free-form mode; backspace works', async () => {
    const modal = createAskUserQuestionModal({ id: 'o1', bounds: BOUNDS, request: mkRequest() });
    // Options: A(1), B(2), Other(3)
    modal.handleKey(key('3'));
    modal.handleKey(key('a', { sequence: 'a' } as any));
    modal.handleKey(key('b', { sequence: 'b' } as any));
    modal.handleKey(key('backspace'));
    modal.handleKey(key('c', { sequence: 'c' } as any));
    modal.handleKey(key('return'));
    const r = await modal.promise;
    expect(r.answers.q0).toBe('Other');
    expect(r.otherText?.q0).toBe('ac');
  });

  test('includeOther:false → no Other row, no Other mode', async () => {
    const modal = createAskUserQuestionModal({
      id: 'o2', bounds: BOUNDS,
      request: mkRequest([{ includeOther: false }]),
    });
    // Only options 1, 2. Pressing "3" should do nothing meaningful.
    modal.handleKey(key('3'));
    modal.handleKey(key('1'));
    const r = await modal.promise;
    expect(r.answers.q0).toBe('A');
  });

  test('Esc while in Other mode returns to option list (does not cancel)', async () => {
    const modal = createAskUserQuestionModal({ id: 'o3', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('3'));        // Other
    modal.handleKey(key('x', { sequence: 'x' } as any));
    modal.handleKey(key('escape'));   // back to list
    modal.handleKey(key('1'));        // pick A instead
    const r = await modal.promise;
    expect(r.answers.q0).toBe('A');
    expect(r.otherText).toBeUndefined();
  });

  test('empty Other buffer does not submit', async () => {
    const modal = createAskUserQuestionModal({ id: 'o4', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('3'));         // Other
    modal.handleKey(key('return'));    // empty buffer: nothing happens
    modal.handleKey(key('y', { sequence: 'y' } as any));
    modal.handleKey(key('return'));
    const r = await modal.promise;
    expect(r.answers.q0).toBe('Other');
    expect(r.otherText?.q0).toBe('y');
  });
});

describe('createAskUserQuestionModal — multi-question walk', () => {
  test('answers accumulate across questions', async () => {
    const modal = createAskUserQuestionModal({
      id: 'mq', bounds: BOUNDS,
      request: mkRequest([{ id: 'first' }, { id: 'second' }]),
    });
    modal.handleKey(key('1'));         // Q1 → A
    modal.handleKey(key('2'));         // Q2 → B
    const r = await modal.promise;
    expect(r.answers.first).toBe('A');
    expect(r.answers.second).toBe('B');
    expect(r.cancelled).toBeUndefined();
  });

  test('Esc mid-walk resolves with partial answers + cancelled:true', async () => {
    const modal = createAskUserQuestionModal({
      id: 'mq2', bounds: BOUNDS,
      request: mkRequest([{ id: 'first' }, { id: 'second' }]),
    });
    modal.handleKey(key('1'));         // Q1 → A
    modal.handleKey(key('escape'));    // cancel before Q2
    const r = await modal.promise;
    expect(r.cancelled).toBe(true);
    expect(r.answers.first).toBe('A');
    expect(r.answers.second).toBeUndefined();
  });
});

describe('createAskUserQuestionModal — misc', () => {
  test('Ctrl+G resolves cancelled', async () => {
    const modal = createAskUserQuestionModal({ id: 'c1', bounds: BOUNDS, request: mkRequest() });
    modal.handleKey(key('g', { ctrl: true }));
    const r = await modal.promise;
    expect(r.cancelled).toBe(true);
  });

  test('surface.paint returns non-empty ANSI when modal is open', () => {
    const modal = createAskUserQuestionModal({ id: 'p1', bounds: BOUNDS, request: mkRequest() });
    const ansi = modal.surface.paint!();
    expect(ansi.length).toBeGreaterThan(0);
    expect(ansi).toContain('Question 0?');
    expect(ansi).toContain('✕');
  });

  test('dispose() before any answer resolves cancelled', async () => {
    const modal = createAskUserQuestionModal({ id: 'd1', bounds: BOUNDS, request: mkRequest() });
    modal.dispose();
    const r = await modal.promise;
    expect(r.cancelled).toBe(true);
  });
});
