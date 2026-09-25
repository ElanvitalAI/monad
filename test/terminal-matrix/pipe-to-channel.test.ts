import { describe, expect, test } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import { TerminalRegistry } from '../../src/terminal-matrix/registry.js';
import { ChannelBus, type ChannelMessage } from '../../src/terminal-matrix/channel-bus.js';

/** Fake PreviewTerminal that supports addRawOutputTap + exposes a
 *  `feed(chunk)` method tests call to simulate PTY output. */
function fakePreviewWithRawTap(opts: PreviewTerminalOpts): PreviewTerminal {
  let alive = false;
  const taps = new Set<(chunk: string) => void>();
  const fake = {
    start: () => { alive = true; },
    stop: () => { alive = false; },
    write: () => {},
    resize: () => {},
    render: () => '',
    cursorPosition: () => null,
    get isAlive(): boolean { return alive; },
    get cols(): number { return opts.cols; },
    get rows(): number { return opts.rows; },
    get pid(): number { return 1; },
    get isScrolledBack(): boolean { return false; },
    get scrollbackOffset(): number { return 0; },
    get wantsMouse(): boolean { return false; },
    scrollUp: () => 0,
    scrollDown: () => 0,
    scrollToTop: () => {},
    scrollToTail: () => {},
    forwardMouse: () => {},
    addRawOutputTap(cb: (chunk: string) => void) {
      taps.add(cb);
      return () => { taps.delete(cb); };
    },
    _feed(chunk: string) {
      for (const cb of taps) cb(chunk);
    },
  };
  return fake as unknown as PreviewTerminal;
}

function makeFixture() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: fakePreviewWithRawTap,
  });
  const bus = new ChannelBus();
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
    channelBus: bus,
  });
  return { matrix, bus };
}

describe('TerminalRegistry.pipeToChannel', () => {
  test('raw-mode pipe publishes every chunk as-is', () => {
    const { matrix, bus } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const received: ChannelMessage[] = [];
    bus.subscribe('logs', (m) => received.push(m));
    const handle = matrix.pipeToChannel(inst.id, 'logs');
    // Simulate PTY output.
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('hello ');
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('world\n');
    expect(received).toHaveLength(2);
    expect(received[0]!.payload).toBe('hello ');
    expect(received[1]!.payload).toBe('world\n');
    expect(received[0]!.from).toBe(inst.id);
    expect(handle.channel).toBe('logs');
    expect(handle.lineMode).toBe(false);
  });

  test('line-mode pipe publishes one message per line', () => {
    const { matrix, bus } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const received: string[] = [];
    bus.subscribe('lines', (m) => received.push(m.payload as string));
    matrix.pipeToChannel(inst.id, 'lines', { lineMode: true });
    const feed = (c: string) => (inst.pty as unknown as { _feed: (s: string) => void })._feed(c);
    feed('line-one\nline-two\n');
    feed('part-');
    feed('ial\nlast\n');
    expect(received).toEqual(['line-one', 'line-two', 'part-ial', 'last']);
  });

  test('line-mode strips trailing \\r (CRLF tolerance)', () => {
    const { matrix, bus } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const received: string[] = [];
    bus.subscribe('crlf', (m) => received.push(m.payload as string));
    matrix.pipeToChannel(inst.id, 'crlf', { lineMode: true });
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('windows\r\nunix\nmixed\r\n');
    expect(received).toEqual(['windows', 'unix', 'mixed']);
  });

  test('unsubscribe detaches + flushes partial line in line-mode', () => {
    const { matrix, bus } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const received: string[] = [];
    bus.subscribe('c', (m) => received.push(m.payload as string));
    const handle = matrix.pipeToChannel(inst.id, 'c', { lineMode: true });
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('complete\nleftover');
    expect(received).toEqual(['complete']);
    handle.unsubscribe();
    expect(received).toEqual(['complete', 'leftover']);
    // After unsubscribe further chunks do NOT publish.
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('ignored\n');
    expect(received).toEqual(['complete', 'leftover']);
  });

  test('listPipes enumerates active pipes', () => {
    const { matrix } = makeFixture();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    const h1 = matrix.pipeToChannel(a.id, 'x');
    const h2 = matrix.pipeToChannel(b.id, 'y', { lineMode: true });
    const listed = matrix.listPipes();
    expect(listed).toHaveLength(2);
    expect(listed.map(p => p.channel).sort()).toEqual(['x', 'y']);
    h1.unsubscribe();
    expect(matrix.listPipes()).toHaveLength(1);
    h2.unsubscribe();
    expect(matrix.listPipes()).toHaveLength(0);
  });

  test('pipeToChannel throws for unknown terminal id', () => {
    const { matrix } = makeFixture();
    expect(() => matrix.pipeToChannel('term:999', 'x'))
      .toThrow(/not found/);
  });

  test('multiple pipes on same terminal publish independently', () => {
    const { matrix, bus } = makeFixture();
    const inst = matrix.spawn({ title: 't', cwd: '/tmp' });
    const left: string[] = [];
    const right: string[] = [];
    bus.subscribe('left', (m) => left.push(m.payload as string));
    bus.subscribe('right', (m) => right.push(m.payload as string));
    matrix.pipeToChannel(inst.id, 'left');
    matrix.pipeToChannel(inst.id, 'right');
    (inst.pty as unknown as { _feed: (s: string) => void })._feed('shared\n');
    expect(left).toEqual(['shared\n']);
    expect(right).toEqual(['shared\n']);
  });

  test('terminal A → channel → terminal B stdin (full pipeline)', () => {
    const { matrix, bus } = makeFixture();
    const a = matrix.spawn({ title: 'producer', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'consumer', cwd: '/tmp' });
    // Record what ends up in B's PTY stdin.
    const bWrites: string[] = [];
    const origWrite = b.pty.write.bind(b.pty);
    (b.pty as unknown as { write: (x: string) => void }).write = (bytes) => {
      bWrites.push(bytes);
      origWrite(bytes);
    };
    // Wire: publish channel → write into B's PTY.
    const sub = bus.subscribe('pipe', (msg) => {
      const payload = typeof msg.payload === 'string' ? msg.payload : msg.payload.toString('utf8');
      b.pty.write(payload);
    });
    matrix.pipeToChannel(a.id, 'pipe', { lineMode: true });
    (a.pty as unknown as { _feed: (s: string) => void })._feed('cmd1\ncmd2\n');
    expect(bWrites).toEqual(['cmd1', 'cmd2']);
    sub.unsubscribe();
  });
});
