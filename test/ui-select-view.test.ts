import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { SelectView, type SelectOption } from '../src/ui/widgets/select-view.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { stripAnsi } from '../src/tui.js';

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function renderToLines(view: SelectView<unknown>, w = 40, h = 10, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  view.draw(p);
  return p.lines().map(stripAnsi);
}

type Choice = 'allow' | 'deny' | 'always';

function makeAllowDeny(opts: Partial<Parameters<typeof makeView>[0]> = {}) {
  return makeView({
    options: [
      { value: 'allow',  label: 'Allow',  shortcut: 'y' },
      { value: 'deny',   label: 'Deny',   shortcut: 'd' },
      { value: 'always', label: 'Always', shortcut: 'a' },
    ],
    ...opts,
  });
}

function makeView<T = Choice>(spec: {
  options: SelectOption<T>[];
  title?: string;
  searchable?: boolean;
  multi?: boolean;
  visibleRows?: number;
  wrap?: boolean;
  initialValue?: T;
  feedbackPrompt?: Parameters<typeof SelectView<T>['prototype']['_snapshot']> extends unknown
    ? Partial<{ placeholder: string; optionalFor: T[]; maxLength: number }>
    : never;
  preview?: (o: SelectOption<T>) => string;
  previewMinWidth?: number;
}) {
  const results: { picked?: T | T[]; feedback?: string; cancelled?: boolean; changed: T[] } = { changed: [] };
  const view = new SelectView<T>({
    title: spec.title,
    options: spec.options,
    searchable: spec.searchable,
    multi: spec.multi,
    visibleRows: spec.visibleRows,
    wrap: spec.wrap,
    initialValue: spec.initialValue,
    feedbackPrompt: spec.feedbackPrompt as never,
    preview: spec.preview,
    previewMinWidth: spec.previewMinWidth,
    onChange: v => results.changed.push(v),
    onSubmit: (picked, feedback) => { results.picked = picked; results.feedback = feedback; },
    onCancel: () => { results.cancelled = true; },
  });
  return { view, results };
}

describe('LC6 SelectView — basic navigation', () => {
  test('initial cursor is 0 and title renders on first row', () => {
    const { view } = makeView({ title: 'Pick one', options: [{ value: 1, label: 'one' }, { value: 2, label: 'two' }] });
    const lines = renderToLines(view);
    expect(lines[0]).toContain('Pick one');
    expect(lines[1]).toContain('▸');
    expect(lines[1]).toContain('one');
    expect(lines[2]).toContain('two');
  });

  test('down moves cursor and onChange fires', () => {
    const { view, results } = makeView({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    view.onEvent(key('down'));
    expect(view._snapshot().cursor).toBe(1);
    expect(results.changed).toEqual(['b']);
  });

  test('j/k navigate when not searchable', () => {
    const { view } = makeView({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    view.onEvent(key('j'));
    expect(view._snapshot().cursor).toBe(1);
    view.onEvent(key('k'));
    expect(view._snapshot().cursor).toBe(0);
  });

  test('Ctrl-N / Ctrl-P navigate', () => {
    const { view } = makeView({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    view.onEvent(key('n', { ctrl: true }));
    expect(view._snapshot().cursor).toBe(1);
    view.onEvent(key('p', { ctrl: true }));
    expect(view._snapshot().cursor).toBe(0);
  });

  test('wrap at top/bottom when wrap=true (default)', () => {
    const { view } = makeView({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    view.onEvent(key('up'));
    expect(view._snapshot().cursor).toBe(1);
    view.onEvent(key('down'));
    expect(view._snapshot().cursor).toBe(0);
  });

  test('wrap=false clamps at boundaries', () => {
    const { view } = makeView({ wrap: false, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    view.onEvent(key('up'));
    expect(view._snapshot().cursor).toBe(0);
    view.onEvent(key('down'));
    view.onEvent(key('down'));
    expect(view._snapshot().cursor).toBe(1);
  });

  test('home / end jump to edges', () => {
    const { view } = makeView({ options: Array.from({ length: 5 }, (_, i) => ({ value: i, label: `L${i}` })) });
    view.onEvent(key('end'));
    expect(view._snapshot().cursor).toBe(4);
    view.onEvent(key('home'));
    expect(view._snapshot().cursor).toBe(0);
  });
});

describe('LC6 SelectView — submission', () => {
  test('Enter submits the focused value', () => {
    const { view, results } = makeAllowDeny();
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    expect(results.picked).toBe('deny');
  });

  test('Escape cancels and fires onCancel', () => {
    const { view, results } = makeAllowDeny();
    view.onEvent(key('escape'));
    expect(results.cancelled).toBe(true);
  });

  test('numeric fast-pick (non-searchable)', () => {
    const { view, results } = makeAllowDeny();
    view.onEvent(key('2'));
    expect(results.picked).toBe('deny');
  });

  test('shortcut letter picks directly', () => {
    const { view, results } = makeAllowDeny();
    view.onEvent(key('a'));
    expect(results.picked).toBe('always');
  });

  test('action closure runs before onSubmit', () => {
    let fired = 0;
    const view = new SelectView<'x'>({
      options: [{ value: 'x', label: 'X', action: () => { fired++; } }],
      onSubmit: () => {},
    });
    view.onEvent(key('enter'));
    expect(fired).toBe(1);
  });

  test('initialValue places cursor correctly', () => {
    const { view } = makeAllowDeny({ initialValue: 'deny' });
    expect(view._snapshot().cursor).toBe(1);
  });
});

describe('LC6 SelectView — disabled', () => {
  test('disabled options can be landed on but Enter bails', () => {
    const { view, results } = makeView({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true, disabledReason: 'locked' },
      ],
    });
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    expect(results.picked).toBeUndefined();
  });

  test('disabled reason appears in render when focused', () => {
    const { view } = makeView({
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true, disabledReason: 'locked' },
      ],
    });
    view.onEvent(key('down'));
    const lines = renderToLines(view, 50, 6);
    expect(lines.join('\n')).toContain('(locked)');
  });
});

describe('LC6 SelectView — searchable', () => {
  test('typing filters the list', () => {
    const { view } = makeView({
      searchable: true,
      options: [
        { value: 'apple',  label: 'apple' },
        { value: 'banana', label: 'banana' },
        { value: 'cherry', label: 'cherry' },
      ],
    });
    view.onEvent(key('b'));
    expect(view._snapshot().query).toBe('b');
    expect(view._snapshot().filteredCount).toBe(1);
    view.onEvent(key('enter'));
  });

  test('backspace shrinks query', () => {
    const { view } = makeView({
      searchable: true,
      options: [
        { value: 'a', label: 'apple' },
        { value: 'b', label: 'banana' },
      ],
    });
    view.onEvent(key('a'));
    view.onEvent(key('p'));
    expect(view._snapshot().filteredCount).toBe(1);
    view.onEvent(key('backspace'));
    expect(view._snapshot().query).toBe('a');
  });

  test('j/k do NOT navigate in searchable mode (they append to query)', () => {
    const { view } = makeView({
      searchable: true,
      options: [{ value: 'a', label: 'junk' }, { value: 'b', label: 'kite' }],
    });
    view.onEvent(key('j'));
    expect(view._snapshot().query).toBe('j');
    // arrow keys still navigate
    view.onEvent(key('down'));
    // only 1 filtered item ('junk'), so cursor stays 0
    expect(view._snapshot().cursor).toBe(0);
  });

  test('numeric digits go to query (not fast-pick) when searchable', () => {
    const { view, results } = makeView({
      searchable: true,
      options: [{ value: 'a', label: 'option 1' }, { value: 'b', label: 'other' }],
    });
    view.onEvent(key('1'));
    expect(view._snapshot().query).toBe('1');
    expect(results.picked).toBeUndefined();
  });
});

describe('LC6 SelectView — multi select', () => {
  test('Space toggles membership, Enter submits array', () => {
    const { view, results } = makeView<string>({
      multi: true,
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
      ],
    });
    view.onEvent(key('space'));          // x
    view.onEvent(key('down'));
    view.onEvent(key('down'));
    view.onEvent(key('space'));          // z
    view.onEvent(key('enter'));
    expect(results.picked).toEqual(['x', 'z']);
  });

  test('Space on disabled item is a no-op', () => {
    const { view } = makeView<string>({
      multi: true,
      options: [
        { value: 'x', label: 'X', disabled: true },
        { value: 'y', label: 'Y' },
      ],
    });
    view.onEvent(key('space'));
    expect(view._snapshot().multi).toEqual([]);
  });
});

describe('LC6 SelectView — feedback prompt', () => {
  test('submitting picks with feedback required for denied', () => {
    const { view, results } = makeView<Choice>({
      options: [
        { value: 'allow', label: 'Allow' },
        { value: 'deny',  label: 'Deny' },
      ],
      feedbackPrompt: { placeholder: 'why?', optionalFor: ['allow'] },
    });
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    // should now be in feedback mode, no submit yet
    expect(results.picked).toBeUndefined();
    expect(view._snapshot().mode).toBe('feedback');
    view.onEvent(key('b'));
    view.onEvent(key('a'));
    view.onEvent(key('d'));
    view.onEvent(key('enter'));
    expect(results.picked).toBe('deny');
    expect(results.feedback).toBe('bad');
  });

  test('optionalFor bypasses feedback', () => {
    const { view, results } = makeView<Choice>({
      options: [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }],
      feedbackPrompt: { placeholder: 'why?', optionalFor: ['allow'] },
    });
    view.onEvent(key('enter'));
    expect(results.picked).toBe('allow');
    expect(results.feedback).toBeUndefined();
  });

  test('Escape from feedback returns to list without submitting', () => {
    const { view, results } = makeView<Choice>({
      options: [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }],
      feedbackPrompt: { placeholder: 'why?' },
    });
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    view.onEvent(key('n'));
    view.onEvent(key('o'));
    view.onEvent(key('escape'));
    expect(view._snapshot().mode).toBe('list');
    expect(results.picked).toBeUndefined();
  });

  test('feedback capped at maxLength', () => {
    const { view, results } = makeView<Choice>({
      options: [{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }],
      feedbackPrompt: { placeholder: 'why?', maxLength: 3 },
    });
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    view.onEvent(key('x'));
    view.onEvent(key('y'));
    view.onEvent(key('z'));
    view.onEvent(key('w'));    // rejected
    view.onEvent(key('enter'));
    expect(results.feedback).toBe('xyz');
  });
});

describe('LC6 SelectView — input-type option', () => {
  test('input option flips to input mode and submits typed text as feedback', () => {
    const { view, results } = makeView<'other' | 'allow'>({
      options: [
        { value: 'allow', label: 'Allow' },
        { value: 'other', label: 'Other (specify)', inputType: { placeholder: 'reason' } },
      ],
    });
    view.onEvent(key('down'));
    view.onEvent(key('enter'));
    expect(view._snapshot().mode).toBe('input');
    view.onEvent(key('f'));
    view.onEvent(key('o'));
    view.onEvent(key('o'));
    view.onEvent(key('enter'));
    expect(results.picked).toBe('other');
    expect(results.feedback).toBe('foo');
  });

  test('empty submit + allowEmptySubmitToCancel cancels', () => {
    const { view, results } = makeView<'other'>({
      options: [{ value: 'other', label: 'Other', inputType: { placeholder: 'x', allowEmptySubmitToCancel: true } }],
    });
    view.onEvent(key('enter'));
    view.onEvent(key('enter'));
    expect(results.cancelled).toBe(true);
  });
});

describe('LC6 SelectView — viewport scroll', () => {
  test('cursor stays visible in long list', () => {
    const opts = Array.from({ length: 20 }, (_, i) => ({ value: i, label: `opt ${i}` }));
    const { view } = makeView({ options: opts, visibleRows: 4 });
    // scroll down past the window
    for (let i = 0; i < 10; i++) view.onEvent(key('down'));
    const snap = view._snapshot();
    expect(snap.cursor).toBe(10);
    expect(snap.scroll).toBeGreaterThan(0);
    expect(snap.cursor - snap.scroll).toBeLessThanOrEqual(3);
  });
});

describe('LC6 SelectView — preview panel', () => {
  test('side-by-side preview renders when width allows', () => {
    const { view } = makeView({
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      preview: o => `detail: ${o.label}`,
      previewMinWidth: 30,
    });
    const lines = renderToLines(view, 60, 6);
    expect(lines.join('\n')).toContain('detail: A');
  });

  test('narrow width drops the preview panel', () => {
    const { view } = makeView({
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      preview: o => `detail: ${o.label}`,
      previewMinWidth: 200,
    });
    const lines = renderToLines(view, 20, 6);
    expect(lines.join('\n')).not.toContain('detail: A');
  });
});

describe('LC6 SelectView — layout', () => {
  test('requiredSize respects constraint', () => {
    const { view } = makeView({
      title: 'Pick',
      options: Array.from({ length: 20 }, (_, i) => ({ value: i, label: `option ${i}` })),
      visibleRows: 5,
    });
    const req = view.requiredSize({ width: 100, height: 100 });
    expect(req.width).toBeLessThanOrEqual(100);
    expect(req.height).toBeLessThanOrEqual(100);
    expect(req.height).toBe(1 /* title */ + 5 /* rows */ + 1 /* footer */);
  });

  test('takeFocus returns true', () => {
    const { view } = makeAllowDeny();
    expect(view.takeFocus()).toBe(true);
  });
});
