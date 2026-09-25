import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { KeyEvent } from '../src/plugins/core/types.js';
import { Button } from '../src/ui/widgets/button.js';
import { EditView } from '../src/ui/widgets/edit-view.js';
import { Dialog } from '../src/ui/widgets/dialog.js';
import { PermissionPrompt } from '../src/ui/widgets/permission-prompt.js';
import { debug } from '../src/debug/log.js';

type LogEntry = [string, string, Record<string, unknown>];

function captureLogs(): { logs: LogEntry[]; restore: () => void } {
  const logs: LogEntry[] = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data: Record<string, unknown>) => {
    logs.push([category, event, data]);
  }) as typeof debug.log;
  return { logs, restore: () => { debug.log = originalLog; } };
}

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

function render(view: { draw: (p: Printer) => void }, w = 40, h = 6, focused = true): string[] {
  const p = Printer.create({ width: w, height: h, focused });
  view.draw(p);
  return p.lines().map(stripAnsi);
}

describe('LC7 Button', () => {
  test('renders "[ label ]" bracketed', () => {
    let clicked = 0;
    const b = new Button({ label: 'OK', onClick: () => { clicked++; } });
    b.takeFocus();
    const lines = render(b, 20, 1);
    expect(lines[0]!.trimEnd()).toBe('[ OK ]');
  });

  test('Enter triggers onClick when focused', () => {
    let clicked = 0;
    const b = new Button({ label: 'Go', onClick: () => { clicked++; } });
    b.takeFocus();
    b.onEvent(key('enter'));
    expect(clicked).toBe(1);
  });

  test('Space triggers onClick when focused', () => {
    let clicked = 0;
    const b = new Button({ label: 'Go', onClick: () => { clicked++; } });
    b.takeFocus();
    b.onEvent(key('space'));
    expect(clicked).toBe(1);
  });

  test('unfocused button ignores keys', () => {
    let clicked = 0;
    const b = new Button({ label: 'Go', onClick: () => { clicked++; } });
    b.onEvent(key('enter'));
    expect(clicked).toBe(0);
  });

  test('requiredSize fits label + brackets', () => {
    const b = new Button({ label: 'Hello', onClick: () => {} });
    expect(b.requiredSize({ width: 50, height: 1 })).toEqual({ width: 9, height: 1 });
  });

  test('blur stops handling clicks', () => {
    let clicked = 0;
    const b = new Button({ label: 'Go', onClick: () => { clicked++; } });
    b.takeFocus();
    b.blur();
    b.onEvent(key('enter'));
    expect(clicked).toBe(0);
  });
});

describe('LC7 EditView', () => {
  test('initial placeholder renders when empty', () => {
    const v = new EditView({ placeholder: 'type here' });
    v.takeFocus();
    const lines = render(v, 30, 1);
    expect(lines[0]).toContain('type here');
  });

  test('typing appends to buffer and fires onChange', () => {
    let last = '';
    const v = new EditView({ onChange: s => { last = s; } });
    v.takeFocus();
    v.onEvent(key('h'));
    v.onEvent(key('i'));
    expect(v.value).toBe('hi');
    expect(last).toBe('hi');
  });

  test('space inserts a space', () => {
    const v = new EditView();
    v.takeFocus();
    v.onEvent(key('a'));
    v.onEvent(key('space'));
    v.onEvent(key('b'));
    expect(v.value).toBe('a b');
  });

  test('backspace deletes previous char', () => {
    const v = new EditView({ initialValue: 'abc' });
    v.takeFocus();
    v.onEvent(key('backspace'));
    expect(v.value).toBe('ab');
  });

  test('delete removes char at cursor', () => {
    const v = new EditView({ initialValue: 'abc' });
    v.takeFocus();
    v.onEvent(key('home'));
    v.onEvent(key('delete'));
    expect(v.value).toBe('bc');
  });

  test('left/right move cursor', () => {
    const v = new EditView({ initialValue: 'abc' });
    v.takeFocus();
    v.onEvent(key('left'));
    v.onEvent(key('x'));
    expect(v.value).toBe('abxc');
  });

  test('home/end jump cursor', () => {
    const v = new EditView({ initialValue: 'abc' });
    v.takeFocus();
    v.onEvent(key('home'));
    v.onEvent(key('x'));
    expect(v.value).toBe('xabc');
    v.onEvent(key('end'));
    v.onEvent(key('y'));
    expect(v.value).toBe('xabcy');
  });

  test('Ctrl-U kills to beginning', () => {
    const v = new EditView({ initialValue: 'hello world' });
    v.takeFocus();
    v.onEvent(key('end'));
    v.onEvent(key('u', { ctrl: true }));
    expect(v.value).toBe('');
  });

  test('Ctrl-W kills previous word', () => {
    const v = new EditView({ initialValue: 'hello world' });
    v.takeFocus();
    v.onEvent(key('end'));
    v.onEvent(key('w', { ctrl: true }));
    expect(v.value).toBe('hello ');
  });

  test('Enter fires onSubmit with value', () => {
    let submitted = '';
    const v = new EditView({ initialValue: 'x', onSubmit: s => { submitted = s; } });
    v.takeFocus();
    v.onEvent(key('enter'));
    expect(submitted).toBe('x');
  });

  test('Esc fires onCancel', () => {
    let cancelled = false;
    const v = new EditView({ onCancel: () => { cancelled = true; } });
    v.takeFocus();
    v.onEvent(key('escape'));
    expect(cancelled).toBe(true);
  });

  test('cancelOnEmptySubmit: empty Enter calls onCancel', () => {
    let submitted: string | null = null;
    let cancelled = false;
    const v = new EditView({
      cancelOnEmptySubmit: true,
      onSubmit: s => { submitted = s; },
      onCancel: () => { cancelled = true; },
    });
    v.takeFocus();
    v.onEvent(key('enter'));
    expect(cancelled).toBe(true);
    expect(submitted).toBeNull();
  });

  test('maxLength caps input', () => {
    const v = new EditView({ maxLength: 3 });
    v.takeFocus();
    for (const c of 'abcdef') v.onEvent(key(c));
    expect(v.value).toBe('abc');
  });

  test('maskChar hides the rendered buffer while preserving the value', () => {
    const v = new EditView({ initialValue: 'secret', maskChar: '*' });
    v.takeFocus();
    const lines = render(v, 20, 1);
    expect(lines[0]).toContain('******');
    expect(lines[0]).not.toContain('secret');
    expect(v.value).toBe('secret');
  });

  test('records cursor decisions with exact ordered from and to positions', () => {
    const { logs, restore } = captureLogs();
    try {
      const v = new EditView({ initialValue: 'ab' });
      v.takeFocus();
      v.onEvent(key('left'));
      v.onEvent(key('x'));
      v.onEvent(key('backspace'));
      v.setValue('');
      expect(logs).toEqual([
        ['ui.edit-view', 'left', { from: 2, to: 1 }],
        ['ui.edit-view', 'insert', { from: 1, to: 2 }],
        ['ui.edit-view', 'backspace', { from: 2, to: 1 }],
        ['ui.edit-view', 'set-value', { from: 1, to: 0 }],
      ]);
    } finally {
      restore();
    }
  });

  test('records the initiating change before an onChange re-entry', () => {
    const { logs, restore } = captureLogs();
    try {
      let v: EditView;
      v = new EditView({
        initialValue: 'a',
        onChange: () => { v.setValue(''); },
      });
      v.takeFocus();
      v.onEvent(key('x'));
      expect(logs).toEqual([
        ['ui.edit-view', 'insert', { from: 1, to: 2 }],
        ['ui.edit-view', 'set-value', { from: 2, to: 0 }],
      ]);
    } finally {
      restore();
    }
  });

  test('does not log boundary, unchanged input, or repeated rendering', () => {
    const { logs, restore } = captureLogs();
    try {
      const v = new EditView({ initialValue: 'a', maxLength: 1 });
      v.takeFocus();
      v.onEvent(key('end'));
      v.onEvent(key('right'));
      v.onEvent(key('delete'));
      v.onEvent(key('x'));
      render(v, 20, 1);
      render(v, 20, 1);
      expect(logs).toEqual([]);
    } finally {
      restore();
    }
  });

  test('continues editing when cursor observability throws', () => {
    const originalLog = debug.log;
    debug.log = (() => { throw new Error('log sink unavailable'); }) as typeof debug.log;
    try {
      const v = new EditView();
      v.takeFocus();
      v.onEvent(key('x'));
      expect(v.value).toBe('x');
    } finally {
      debug.log = originalLog;
    }
  });
});

describe('LC7 Dialog', () => {
  test('renders title, body, and buttons in a bordered frame', () => {
    const d = new Dialog<'yes' | 'no'>({
      title: 'Confirm',
      body: 'Proceed?',
      buttons: [
        { label: 'Yes', value: 'yes', shortcut: 'y' },
        { label: 'No',  value: 'no',  shortcut: 'n' },
      ],
      onSubmit: () => {},
    });
    d.takeFocus();
    const lines = render(d, 30, 5);
    expect(lines[0]).toContain('Confirm');
    expect(lines.join('\n')).toContain('Proceed?');
    expect(lines.join('\n')).toContain('[ Yes ]');
    expect(lines.join('\n')).toContain('[ No ]');
  });

  test('Enter on focused button fires onSubmit', () => {
    let picked: string | null = null;
    const d = new Dialog<'yes' | 'no'>({
      title: 't',
      buttons: [
        { label: 'Yes', value: 'yes' },
        { label: 'No',  value: 'no' },
      ],
      onSubmit: v => { picked = v; },
    });
    d.takeFocus();
    d.onEvent(key('enter'));
    expect(picked).toBe('yes');
  });

  test('Right arrow cycles focus to the next button', () => {
    let picked: string | null = null;
    const d = new Dialog<'yes' | 'no'>({
      title: 't',
      buttons: [
        { label: 'Yes', value: 'yes' },
        { label: 'No',  value: 'no' },
      ],
      onSubmit: v => { picked = v; },
    });
    d.takeFocus();
    d.onEvent(key('right'));
    d.onEvent(key('enter'));
    expect(picked).toBe('no');
  });

  test('shortcut letters pick regardless of focus', () => {
    let picked: string | null = null;
    const d = new Dialog<'yes' | 'no'>({
      title: 't',
      buttons: [
        { label: 'Yes', value: 'yes', shortcut: 'y' },
        { label: 'No',  value: 'no',  shortcut: 'n' },
      ],
      onSubmit: v => { picked = v; },
    });
    d.takeFocus();
    d.onEvent(key('n'));
    expect(picked).toBe('no');
  });

  test('Esc fires onCancel', () => {
    let cancelled = false;
    const d = new Dialog<'yes'>({
      title: 't',
      buttons: [{ label: 'Yes', value: 'yes' }],
      onSubmit: () => {},
      onCancel: () => { cancelled = true; },
    });
    d.takeFocus();
    d.onEvent(key('escape'));
    expect(cancelled).toBe(true);
  });

  test('Dialog without body works (just title + buttons)', () => {
    let picked: string | null = null;
    const d = new Dialog<'ok'>({
      title: 'OK?',
      buttons: [{ label: 'OK', value: 'ok' }],
      onSubmit: v => { picked = v; },
    });
    d.takeFocus();
    d.onEvent(key('enter'));
    expect(picked).toBe('ok');
  });
});

describe('LC7 PermissionPrompt', () => {
  test('renders title and choices', () => {
    const p = new PermissionPrompt<'allow' | 'deny'>({
      title: 'Apply edit?',
      choices: [
        { value: 'allow', label: 'Allow', positive: true },
        { value: 'deny',  label: 'Deny' },
      ],
      onSubmit: () => {},
    });
    p.takeFocus();
    const lines = render(p, 40, 6);
    const joined = lines.join('\n');
    expect(joined).toContain('Apply edit?');
    expect(joined).toContain('Allow');
    expect(joined).toContain('Deny');
  });

  test('allow (positive) submits without feedback', () => {
    let picked: string | null = null;
    let feedback: string | undefined;
    const p = new PermissionPrompt<'allow' | 'deny'>({
      title: 't',
      choices: [
        { value: 'allow', label: 'Allow', positive: true },
        { value: 'deny',  label: 'Deny' },
      ],
      onSubmit: (v, f) => { picked = v; feedback = f; },
    });
    p.takeFocus();
    p.onEvent(key('enter'));
    expect(picked).toBe('allow');
    expect(feedback).toBeUndefined();
  });

  test('deny requires feedback before submit', () => {
    let picked: string | null = null;
    let feedback = '';
    const p = new PermissionPrompt<'allow' | 'deny'>({
      title: 't',
      choices: [
        { value: 'allow', label: 'Allow', positive: true },
        { value: 'deny',  label: 'Deny' },
      ],
      onSubmit: (v, f) => { picked = v; feedback = f ?? ''; },
    });
    p.takeFocus();
    p.onEvent(key('down'));
    p.onEvent(key('enter'));
    // now in feedback mode
    expect(picked).toBeNull();
    p.onEvent(key('b'));
    p.onEvent(key('a'));
    p.onEvent(key('d'));
    p.onEvent(key('enter'));
    expect(picked).toBe('deny');
    expect(feedback).toBe('bad');
  });

  test('auto-assigns shortcut letters from label first char', () => {
    let picked: string | null = null;
    const p = new PermissionPrompt<'allow' | 'deny'>({
      title: 't',
      choices: [
        { value: 'allow', label: 'Allow', positive: true },
        { value: 'deny',  label: 'Deny' },
      ],
      onSubmit: v => { picked = v; },
    });
    p.takeFocus();
    p.onEvent(key('a'));
    expect(picked).toBe('allow');
  });
});
