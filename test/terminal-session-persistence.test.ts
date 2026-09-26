import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  loadPersistedSessions,
  savePersistedSessions,
  wirePersistence,
  type PersistedSession,
} from '../src/terminal/session-persistence.js';
import { TerminalSessionRegistry } from '../src/terminal/session-registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { PreviewTerminalOpts, PreviewTerminal } from '../src/preview/terminal.js';

function tmpFile(): string {
  const dir = joinPath(tmpdir(), `elanous-term-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return joinPath(dir, 'sessions.json');
}

function fakePreview(opts: PreviewTerminalOpts): PreviewTerminal {
  return {
    start: () => {},
    stop: () => {},
    write: () => {},
    resize: () => {},
    render: () => '',
    cursorPosition: () => null,
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

describe('save + load roundtrip', () => {
  test('empty file yields empty list', () => {
    expect(loadPersistedSessions('/nonexistent/path.json')).toEqual([]);
  });

  test('save then load preserves fields', () => {
    const path = tmpFile();
    const sessions: PersistedSession[] = [
      { id: 'a', title: 'claude', cwd: '/tmp', command: 'claude', kind: 'coding-agent', agentBrand: 'claude-code', termName: 'xterm-ghostty', startedAt: 1000, lastFocusedAt: 2000 },
      { id: 'b', title: 'yazi',   cwd: '/tmp', command: 'yazi',   kind: 'shell',         startedAt: 1500, lastFocusedAt: 1500 },
    ];
    savePersistedSessions(sessions, path);
    const loaded = loadPersistedSessions(path);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.agentBrand).toBe('claude-code');
    rmSync(path, { force: true });
  });

  test('malformed JSON → empty list (no throw)', () => {
    const path = tmpFile();
    require('node:fs').writeFileSync(path, '{not valid}', 'utf-8');
    expect(loadPersistedSessions(path)).toEqual([]);
    rmSync(path, { force: true });
  });
});

describe('wirePersistence', () => {
  test('spawn triggers a flush + load sees the session', () => {
    const path = tmpFile();
    const pending: Array<() => void> = [];
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const registry = new TerminalSessionRegistry({ coordinator: coord, terminalFactory: fakePreview });
    const unsub = wirePersistence(registry, {
      path,
      schedule: (fn) => { pending.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearSchedule: () => {},
    });
    registry.spawn({ title: 'a', cwd: '/tmp', command: 'claude' }, { termCols: 100, termRows: 30 });
    // Drain all scheduled flushes
    while (pending.length > 0) {
      const fn = pending.shift()!;
      fn();
    }
    const loaded = loadPersistedSessions(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe('a');
    unsub();
    rmSync(path, { force: true });
  });

  test('attention events do not trigger flush', () => {
    const path = tmpFile();
    const scheduled: number[] = [];
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const registry = new TerminalSessionRegistry({ coordinator: coord, terminalFactory: fakePreview });
    const unsub = wirePersistence(registry, {
      path,
      schedule: (fn) => { scheduled.push(1); fn(); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearSchedule: () => {},
    });
    const initialCount = scheduled.length;
    const s = registry.spawn({ title: 'a', cwd: '/tmp' }, { termCols: 100, termRows: 30 });
    const afterSpawn = scheduled.length;
    registry.raiseAttention(s.id, 2);
    const afterAttention = scheduled.length;
    // Spawn schedules; attention doesn't.
    expect(afterSpawn).toBeGreaterThan(initialCount);
    expect(afterAttention).toBe(afterSpawn);
    unsub();
    rmSync(path, { force: true });
  });

  test('exited sessions are dropped from snapshot', () => {
    const path = tmpFile();
    const pending: Array<() => void> = [];
    const coord = new DisplayCoordinator({ frameMs: 0 });
    const registry = new TerminalSessionRegistry({ coordinator: coord, terminalFactory: fakePreview });
    const unsub = wirePersistence(registry, {
      path,
      schedule: (fn) => { pending.push(fn); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearSchedule: () => {},
    });
    const a = registry.spawn({ title: 'alpha', cwd: '/t' }, { termCols: 100, termRows: 30 });
    registry.spawn({ title: 'beta', cwd: '/t' }, { termCols: 100, termRows: 30 });
    registry.kill(a.id);
    while (pending.length > 0) {
      const fn = pending.shift()!;
      fn();
    }
    const loaded = loadPersistedSessions(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe('beta');
    unsub();
    if (existsSync(path)) rmSync(path, { force: true });
  });
});
