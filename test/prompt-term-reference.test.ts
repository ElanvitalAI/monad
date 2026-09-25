import { describe, expect, test } from 'bun:test';

import { expandTerminalReferences } from '../src/prompt/term-reference.js';
import { TerminalSessionRegistry } from '../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminalOpts, PreviewTerminal } from '../src/preview/terminal.js';

function fakePreview(opts: PreviewTerminalOpts, body: string): PreviewTerminal {
  return {
    start: () => {},
    stop: () => {},
    write: () => {},
    resize: () => {},
    render: () => body,
    cursorPosition: () => ({ row: 0, col: 0 }),
    isAlive: true,
    cols: opts.cols,
    rows: opts.rows,
    pid: 1,
    isScrolledBack: false,
    scrollbackOffset: 0,
    wantsMouse: false,
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
  } as unknown as PreviewTerminal;
}

function makeRegistry(body = 'session body'): TerminalSessionRegistry {
  return new TerminalSessionRegistry({
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    terminalFactory: (o) => fakePreview(o, body),
  });
}

describe('expandTerminalReferences', () => {
  test('leaves plain text untouched', () => {
    const registry = makeRegistry();
    expect(expandTerminalReferences('no mentions here', registry)).toBe('no mentions here');
  });

  test('leaves unresolved @term:id untouched', () => {
    const registry = makeRegistry();
    const out = expandTerminalReferences('check @term:unknown please', registry);
    expect(out).toBe('check @term:unknown please');
  });

  test('expands matching id to structured block', () => {
    const registry = makeRegistry('hello world');
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`look at @term:${s.id}`, registry);
    expect(out).toContain(`<terminal-session id="${s.id}"`);
    expect(out).toContain('<full-11>');
    expect(out).toContain('hello world');
    expect(out).toContain('</terminal-session>');
  });

  test('suffix match resolves', () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const suffix = s.id.slice(-6);
    const out = expandTerminalReferences(`check @term:${suffix}`, registry);
    expect(out).toContain(`id="${s.id}"`);
  });

  test('#N byte spec trims tail', () => {
    const registry = makeRegistry('a'.repeat(1000));
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`@term:${s.id}#50`, registry);
    expect(out).toContain('<last-50>');
    // 50 copies of 'a' + wrappers; approx size check
    expect(out.match(/a{50}/)).not.toBeNull();
  });

  test('#all mode returns full snapshot unsliced', () => {
    const registry = makeRegistry('x'.repeat(10000));
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`@term:${s.id}#all`, registry);
    expect(out).toContain('<full>');
    expect(out).toMatch(/x{10000}/);
  });

  test('default tail bytes applies when body exceeds', () => {
    const registry = makeRegistry('y'.repeat(10_000));
    const s = registry.spawn({ title: 'X', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`@term:${s.id}`, registry, { defaultTailBytes: 200 });
    expect(out).toContain('<last-200>');
  });

  test('foreground session wins over bg on ambiguous suffix', () => {
    const registry = makeRegistry();
    const a = registry.spawn({ id: 'term-session:abcX', title: 'a', cwd: '/' }, { termCols: 100, termRows: 30 });
    // When spawning a second session, a is auto-detached.
    const b = registry.spawn({ id: 'term-session:zzzX', title: 'b', cwd: '/' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences('@term:X', registry);
    // Both ids end with 'X'. b is foreground → wins.
    expect(out).toContain(`id="${b.id}"`);
    expect(a.id).toBeTruthy();
  });

  test('escapes attribute special chars', () => {
    const registry = makeRegistry();
    const s = registry.spawn({ title: 'say "hi"', cwd: '/tmp/<odd>' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`@term:${s.id}`, registry);
    expect(out).toContain('title="say &quot;hi&quot;"');
    expect(out).toContain('cwd="/tmp/&lt;odd&gt;"');
  });

  test('multiple mentions each expand', () => {
    const registry = makeRegistry();
    const a = registry.spawn({ title: 'a', cwd: '/1' }, { termCols: 100, termRows: 30 });
    const b = registry.spawn({ title: 'b', cwd: '/2' }, { termCols: 100, termRows: 30 });
    const out = expandTerminalReferences(`compare @term:${a.id} vs @term:${b.id}`, registry);
    expect(out).toContain(`id="${a.id}"`);
    expect(out).toContain(`id="${b.id}"`);
  });
});
