import { describe, expect, test } from 'bun:test';
import { createPlanExitModal } from '../../src/plan-mode/index.js';
import type { KeyEvent } from '../../src/display/types.js';

const BOUNDS = { row: 3, col: 3, width: 80, height: 20 };

function mkModal(body = 'line 1\nline 2\nline 3\n') {
  return createPlanExitModal({
    id: 'test',
    bounds: BOUNDS,
    title: 'Test plan',
    planBody: body,
  });
}

function key(name: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, ...extra } as KeyEvent;
}

describe('createPlanExitModal — key routing', () => {
  test('pressing i → implement', async () => {
    const m = mkModal();
    m.handleKey(key('i'));
    expect(await m.promise).toBe('implement');
  });

  test('pressing n → handoff', async () => {
    const m = mkModal();
    m.handleKey(key('n'));
    expect(await m.promise).toBe('handoff');
  });

  test('pressing c or Esc → cancel', async () => {
    const a = mkModal();
    a.handleKey(key('c'));
    expect(await a.promise).toBe('cancel');

    const b = mkModal();
    b.handleKey(key('escape'));
    expect(await b.promise).toBe('cancel');
  });

  test('Enter confirms default selection (implement)', async () => {
    const m = mkModal();
    m.handleKey(key('return'));
    expect(await m.promise).toBe('implement');
  });

  // Order after FU-6 (2026-05-05): implement → goal-loop → handoff → cancel
  test('Arrow down + Enter selects goal-loop', async () => {
    const m = mkModal();
    m.handleKey(key('down'));
    m.handleKey(key('return'));
    expect(await m.promise).toBe('goal-loop');
  });

  test('Arrow down twice + Enter selects handoff', async () => {
    const m = mkModal();
    m.handleKey(key('down'));
    m.handleKey(key('down'));
    m.handleKey(key('return'));
    expect(await m.promise).toBe('handoff');
  });

  test('Arrow down 3x + Enter selects cancel', async () => {
    const m = mkModal();
    m.handleKey(key('down'));
    m.handleKey(key('down'));
    m.handleKey(key('down'));
    m.handleKey(key('return'));
    expect(await m.promise).toBe('cancel');
  });


  test('Ctrl+G cancels', async () => {
    const m = mkModal();
    m.handleKey(key('g', { ctrl: true }));
    expect(await m.promise).toBe('cancel');
  });
});

describe('createPlanExitModal — preview scroll', () => {
  test('j scrolls down without resolving', () => {
    const m = mkModal('a\nb\nc\nd\ne\nf\n');
    m.handleKey(key('j'));
    m.handleKey(key('j'));
    // No resolution yet — modal still open.
    const ansi = m.surface.paint!();
    expect(ansi.length).toBeGreaterThan(0);
    m.dispose();  // cleanup
  });

  test('paint includes plan body lines', () => {
    const m = mkModal('unique-line-xyz\n');
    const ansi = m.surface.paint!();
    expect(ansi).toContain('unique-line-xyz');
    expect(ansi).toContain('✕');
    m.dispose();
  });

  test('paint shows the 3 action labels', () => {
    const m = mkModal();
    const ansi = m.surface.paint!();
    expect(ansi).toContain('Implement now');
    expect(ansi).toContain('Save + new session');
    expect(ansi).toContain('Cancel');
    m.dispose();
  });
});

describe('createPlanExitModal — dispose', () => {
  test('dispose() defaults to cancel', async () => {
    const m = mkModal();
    m.dispose();
    expect(await m.promise).toBe('cancel');
  });

  test('dispose("implement") resolves implement', async () => {
    const m = mkModal();
    m.dispose('implement');
    expect(await m.promise).toBe('implement');
  });
});
