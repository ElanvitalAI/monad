import { describe, expect, test } from 'bun:test';

import { TerminalSessionRegistry } from '../../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../../src/display/coordinator.js';
import type { PreviewTerminal, PreviewTerminalOpts } from '../../src/preview/terminal.js';
import { TerminalRegistry } from '../../src/terminal-matrix/registry.js';
import { BroadcastBus } from '../../src/terminal-matrix/broadcast-bus.js';

function makeFakePreview(writes: string[]) {
  let alive = false;
  return ((opts: PreviewTerminalOpts) => {
    return {
      start: () => { alive = true; },
      stop: () => { alive = false; },
      write: (bytes: string) => writes.push(bytes),
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
    } as unknown as PreviewTerminal;
  });
}

function makeBus() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  // Each spawn gets its own write log so we can verify fanout precisely.
  const writeLogs = new Map<string, string[]>();
  let counter = 0;
  const sessions = new TerminalSessionRegistry({
    coordinator: coord,
    terminalFactory: (opts) => {
      const key = `pty#${++counter}`;
      const log: string[] = [];
      writeLogs.set(key, log);
      return makeFakePreview(log)(opts);
    },
  });
  const matrix = new TerminalRegistry({
    sessionRegistry: sessions,
    termSize: () => ({ cols: 80, rows: 24 }),
  });
  const bus = new BroadcastBus(matrix);
  return { matrix, bus, writeLogs };
}

describe('BroadcastBus', () => {
  test('fans out bytes to every group member', () => {
    const { matrix, bus, writeLogs } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'deploy');
    matrix.joinGroup(b.id, 'deploy');

    const result = bus.broadcastBytes('deploy', 'ls\r');
    expect(result.delivered.sort()).toEqual([a.id, b.id].sort());
    // pty.write got called once per member.
    const allWrites = [...writeLogs.values()].flat();
    expect(allWrites.filter(w => w === 'ls\r').length).toBe(2);
  });

  test('skips readOnly members', () => {
    const { matrix, bus } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    matrix.joinGroup(b.id, 'g');
    matrix.setReadOnly(b.id, true);
    const r = bus.broadcastBytes('g', 'x');
    expect(r.delivered).toEqual([a.id]);
    expect(r.skippedReadOnly).toEqual([b.id]);
  });

  test('skips exited members', () => {
    const { matrix, bus, writeLogs } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    matrix.joinGroup(b.id, 'g');
    matrix.kill(b.id);
    const r = bus.broadcastBytes('g', 'x');
    expect(r.delivered).toEqual([a.id]);
    expect(r.skippedExited).toEqual([b.id]);
    const total = [...writeLogs.values()].flat().filter(w => w === 'x').length;
    expect(total).toBe(1);
  });

  test('empty group delivers to no one', () => {
    const { bus } = makeBus();
    const r = bus.broadcastBytes('nobody', 'hi');
    expect(r.delivered).toEqual([]);
    expect(r.skippedExited).toEqual([]);
    expect(r.skippedReadOnly).toEqual([]);
    expect(r.errored).toEqual([]);
  });

  test('members(group) returns alive members only', () => {
    const { matrix, bus } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    matrix.joinGroup(b.id, 'g');
    matrix.kill(b.id);
    const members = bus.members('g');
    expect(members.map(i => i.id)).toEqual([a.id]);
  });

  test('groups() enumerates across registry', () => {
    const { matrix, bus } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'deploy');
    matrix.joinGroup(a.id, 'monitor');
    matrix.joinGroup(b.id, 'deploy');
    expect(bus.groups()).toEqual(['deploy', 'monitor']);
  });

  test('error in pty.write is captured per-member, fanout continues', () => {
    const { matrix, bus } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    const b = matrix.spawn({ title: 'b', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    matrix.joinGroup(b.id, 'g');
    // Force b's write to throw.
    (b.pty as unknown as { write: (b: string) => void }).write = () => {
      throw new Error('boom');
    };
    const r = bus.broadcastBytes('g', 'x');
    expect(r.delivered).toEqual([a.id]);
    expect(r.errored).toEqual([{ id: b.id, error: 'boom' }]);
  });

  test('broadcastClipboard forwards through broadcastBytes', () => {
    const { matrix, bus } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    const r = bus.broadcastClipboard('g', 'paste body\n');
    expect(r.delivered).toEqual([a.id]);
  });

  test('Buffer payload is converted to utf8 string', () => {
    const { matrix, bus, writeLogs } = makeBus();
    const a = matrix.spawn({ title: 'a', cwd: '/tmp' });
    matrix.joinGroup(a.id, 'g');
    bus.broadcastBytes('g', Buffer.from('안녕', 'utf8'));
    const writes = [...writeLogs.values()].flat();
    expect(writes).toContain('안녕');
  });
});
