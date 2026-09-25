import { describe, expect, test } from 'bun:test';

import { createViEditor } from '../src/vi-editor.js';

function mk(initial = 'line one\nline two\nline three') {
  return createViEditor({ filePath: '/tmp/test.txt', initialText: initial });
}

function type(ed: ReturnType<typeof createViEditor>, chars: string): void {
  for (const c of chars) {
    ed.onKey({ name: c, sequence: c });
  }
}

describe('vi-editor — initial state', () => {
  test('loads multi-line text', () => {
    const ed = mk();
    expect(ed.getState().lines).toEqual(['line one', 'line two', 'line three']);
    expect(ed.getState().mode).toBe('normal');
    expect(ed.isDirty()).toBe(false);
  });

  test('empty string yields a single empty line', () => {
    const ed = createViEditor({ filePath: 'x', initialText: '' });
    expect(ed.getState().lines).toEqual(['']);
  });

  test('getText reassembles', () => {
    const ed = mk('a\nb\nc');
    expect(ed.getText()).toBe('a\nb\nc');
  });
});

describe('vi-editor — normal-mode motion', () => {
  test('h/l/j/k move cursor', () => {
    const ed = mk();
    ed.onKey({ name: 'l' });
    expect(ed.getState().col).toBe(1);
    ed.onKey({ name: 'j' });
    expect(ed.getState().row).toBe(1);
    ed.onKey({ name: 'h' });
    expect(ed.getState().col).toBe(0);
    ed.onKey({ name: 'k' });
    expect(ed.getState().row).toBe(0);
  });

  test('0 and $ move to line start / end', () => {
    const ed = mk();
    ed.onKey({ name: '$' });
    expect(ed.getState().col).toBe(7);   // 'line one' length=8, last idx=7
    ed.onKey({ name: '0' });
    expect(ed.getState().col).toBe(0);
  });

  test('gg and G jump to top and bottom', () => {
    const ed = mk();
    ed.onKey({ name: 'G' });
    expect(ed.getState().row).toBe(2);
    ed.onKey({ name: 'g' });
    ed.onKey({ name: 'g' });
    expect(ed.getState().row).toBe(0);
  });

  test('w jumps to next word start', () => {
    const ed = createViEditor({ filePath: 'x', initialText: 'hello world foo' });
    ed.onKey({ name: 'w' });
    expect(ed.getState().col).toBe(6);  // start of "world"
    ed.onKey({ name: 'w' });
    expect(ed.getState().col).toBe(12); // start of "foo"
  });

  test('b jumps to previous word start', () => {
    const ed = createViEditor({ filePath: 'x', initialText: 'one two three' });
    ed.onKey({ name: '$' });
    ed.onKey({ name: 'b' });
    expect(ed.getState().col).toBe(8);
  });
});

describe('vi-editor — insert mode', () => {
  test('i enters insert; Esc returns to normal', () => {
    const ed = mk();
    ed.onKey({ name: 'i' });
    expect(ed.getState().mode).toBe('insert');
    ed.onKey({ name: 'escape' });
    expect(ed.getState().mode).toBe('normal');
  });

  test('insertion updates buffer + dirty flag', () => {
    const ed = mk('hello');
    ed.onKey({ name: 'i' });
    type(ed, 'X');
    expect(ed.getState().lines[0]).toBe('Xhello');
    expect(ed.isDirty()).toBe(true);
  });

  test('o opens line below and enters insert', () => {
    const ed = mk('one\ntwo');
    ed.onKey({ name: 'o' });
    expect(ed.getState().mode).toBe('insert');
    expect(ed.getState().lines).toEqual(['one', '', 'two']);
    expect(ed.getState().row).toBe(1);
  });

  test('O opens line above', () => {
    const ed = mk('one\ntwo');
    ed.onKey({ name: 'O' });
    expect(ed.getState().lines).toEqual(['', 'one', 'two']);
    expect(ed.getState().row).toBe(0);
  });

  test('Enter in insert splits line', () => {
    const ed = mk('abcdef');
    ed.onKey({ name: 'l' }); ed.onKey({ name: 'l' }); ed.onKey({ name: 'l' });
    ed.onKey({ name: 'i' });
    ed.onKey({ name: 'enter' });
    expect(ed.getState().lines).toEqual(['abc', 'def']);
  });

  test('Backspace joins lines', () => {
    const ed = mk('abc\ndef');
    ed.onKey({ name: 'j' });
    ed.onKey({ name: 'i' });
    ed.onKey({ name: 'backspace' });
    expect(ed.getState().lines).toEqual(['abcdef']);
  });

  test('a enters insert one char after cursor', () => {
    const ed = mk('hi');
    ed.onKey({ name: 'a' });
    expect(ed.getState().mode).toBe('insert');
    expect(ed.getState().col).toBe(1);
  });
});

describe('vi-editor — delete and yank', () => {
  test('x deletes char under cursor', () => {
    const ed = mk('abc');
    ed.onKey({ name: 'x' });
    expect(ed.getState().lines[0]).toBe('bc');
  });

  test('dd deletes line', () => {
    const ed = mk('one\ntwo\nthree');
    ed.onKey({ name: 'd' });
    ed.onKey({ name: 'd' });
    expect(ed.getState().lines).toEqual(['two', 'three']);
  });

  test('yy then p duplicates line', () => {
    const ed = mk('one\ntwo');
    ed.onKey({ name: 'y' });
    ed.onKey({ name: 'y' });
    ed.onKey({ name: 'p' });
    expect(ed.getState().lines).toEqual(['one', 'one', 'two']);
  });

  test('u undoes the last edit', () => {
    const ed = mk('abc');
    ed.onKey({ name: 'i' });
    type(ed, 'X');
    ed.onKey({ name: 'escape' });
    expect(ed.getState().lines[0]).toBe('Xabc');
    ed.onKey({ name: 'u' });
    expect(ed.getState().lines[0]).toBe('abc');
    expect(ed.isDirty()).toBe(false);
  });
});

describe('vi-editor — command mode', () => {
  test(':w triggers save request', () => {
    const ed = mk();
    ed.onKey({ name: ':' });
    type(ed, 'w');
    ed.onKey({ name: 'enter' });
    expect(ed.getState().savedRequested).toBe(true);
    expect(ed.getState().quitRequested).toBe(false);
  });

  test(':q blocks when dirty', () => {
    const ed = mk();
    ed.onKey({ name: 'i' });
    type(ed, 'X');
    ed.onKey({ name: 'escape' });
    ed.onKey({ name: ':' });
    type(ed, 'q');
    ed.onKey({ name: 'enter' });
    expect(ed.getState().quitRequested).toBe(false);
    expect(ed.getState().message).toContain('E37');
  });

  test(':q! forces quit with discard', () => {
    const ed = mk();
    ed.onKey({ name: 'i' });
    type(ed, 'X');
    ed.onKey({ name: 'escape' });
    ed.onKey({ name: ':' });
    type(ed, 'q!');
    ed.onKey({ name: 'enter' });
    expect(ed.getState().quitRequested).toBe(true);
    expect(ed.getState().discardedRequested).toBe(true);
  });

  test(':wq saves + quits', () => {
    const ed = mk();
    ed.onKey({ name: ':' });
    type(ed, 'wq');
    ed.onKey({ name: 'enter' });
    expect(ed.getState().savedRequested).toBe(true);
    expect(ed.getState().quitRequested).toBe(true);
  });

  test('unknown command surfaces error', () => {
    const ed = mk();
    ed.onKey({ name: ':' });
    type(ed, 'zzz');
    ed.onKey({ name: 'enter' });
    expect(ed.getState().message).toContain('E492');
  });

  test('Esc cancels command line', () => {
    const ed = mk();
    ed.onKey({ name: ':' });
    type(ed, 'w');
    ed.onKey({ name: 'escape' });
    expect(ed.getState().mode).toBe('normal');
    expect(ed.getState().commandBuffer).toBe('');
    expect(ed.getState().savedRequested).toBe(false);
  });
});

describe('vi-editor — render', () => {
  test('returns body rows + status line by default', () => {
    const ed = mk('a\nb\nc');
    const rows = ed.render({ cols: 20, rows: 5 });
    expect(rows.length).toBe(5);
    expect(rows[0]).toBe('a');
    expect(rows[3]).toBe('~');
    expect(rows[4]).toContain('test.txt');
  });

  test('dirty flag appears in status line', () => {
    const ed = mk('hello');
    ed.onKey({ name: 'i' });
    type(ed, 'X');
    const rows = ed.render({ cols: 40, rows: 3 });
    expect(rows[rows.length - 1]).toContain('[+]');
  });

  test('INSERT mode label in status', () => {
    const ed = mk();
    ed.onKey({ name: 'i' });
    const rows = ed.render({ cols: 40, rows: 3 });
    expect(rows[rows.length - 1]).toContain('-- INSERT --');
  });
});
