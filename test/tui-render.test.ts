import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ansi, render, resetRenderCache } from '../src/tui.js';

let writes: string[];
let originalWrite: typeof process.stdout.write;
let originalRows: number | undefined;
let originalColumns: number | undefined;

beforeEach(() => {
  writes = [];
  originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  originalRows = process.stdout.rows;
  originalColumns = process.stdout.columns;
  Object.defineProperty(process.stdout, 'rows', { value: 10, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true });
  process.stdout.write = ((chunk: any) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  resetRenderCache();
});

afterEach(() => {
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, 'rows', { value: originalRows, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: originalColumns, configurable: true });
  resetRenderCache();
});

describe('tui render frame cache', () => {
  test('first render clears once and writes every visible row', () => {
    render(['one', 'two']);
    const out = writes.join('');
    expect(out).toContain(ansi.eraseDown);
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  test('unchanged frame does not clear or rewrite rows', () => {
    render(['one', 'two']);
    writes = [];

    render(['one', 'two']);

    const out = writes.join('');
    expect(out).not.toContain(ansi.eraseDown);
    expect(out).not.toContain(ansi.clearLine);
    expect(out).not.toContain('one');
    expect(out).not.toContain('two');
  });

  test('changed frame rewrites only changed rows', () => {
    render(['one', 'two', 'three']);
    writes = [];

    render(['one', 'TWO', 'three']);

    const out = writes.join('');
    expect(out).not.toContain(ansi.eraseDown);
    expect(out).toContain('TWO');
    expect(out).not.toContain('three');
  });

  test('overlay is appended to the same frame write', () => {
    render(['base'], { overlay: `${ansi.moveTo(2, 2)}modal` });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('base');
    expect(writes[0]).toContain('modal');
  });

  test('empty cursor path preserves the prior frame bytes', () => {
    render(['base'], { overlay: 'overlay' });

    expect(writes).toEqual([
      `${ansi.hideCursor}${ansi.moveTo(1, 1)}${ansi.eraseDown}${ansi.moveTo(1, 1)}${ansi.clearLine}baseoverlay`,
    ]);
  });

  test('cursor is the final frame bytes after the overlay', () => {
    const overlay = `${ansi.moveTo(2, 2)}overlay`;
    const cursor = `${ansi.moveTo(1, 6)}${ansi.showCursor}`;

    render(['base'], { overlay, cursor });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEndWith(cursor);
    expect(writes[0]!.indexOf(overlay)).toBeLessThan(writes[0]!.lastIndexOf(cursor));
  });

  test('force repaint clears and rewrites even when rows match', () => {
    render(['one']);
    writes = [];

    render(['one'], { force: true });

    const out = writes.join('');
    expect(out).toContain(ansi.eraseDown);
    expect(out).toContain('one');
  });
});
