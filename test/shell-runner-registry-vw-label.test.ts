// SP-C — getVwLabel reverse lookup.

import { describe, expect, test } from 'bun:test';

import { createShellRegistry } from '../src/shell-runner/registry.js';
import type { ShellHandle, ShellStatus } from '../src/shell-runner/types.js';

function makeHandle(id: string): ShellHandle {
  return {
    id,
    mode: 'vw',
    status: 'running',
    bookmark: { row: 0, col: 0, ts: 0, bytes: 0 },
    kill() { /* noop */ },
    background() { return true; },
    promote() { return true; },
    write() { /* noop */ },
    resize() { /* noop */ },
    onChunk() { return () => {}; },
    onBoundary() { return () => {}; },
    onStatus() { return () => {}; },
    result: new Promise(() => {}),
  };
}

describe('SP-C — ShellRegistry.getVwLabel', () => {
  test('returns null for unknown id', () => {
    const reg = createShellRegistry();
    expect(reg.getVwLabel('nope')).toBeNull();
  });

  test('returns null before tagVwRunner is called', () => {
    const reg = createShellRegistry();
    reg.register(makeHandle('a'));
    expect(reg.getVwLabel('a')).toBeNull();
  });

  test('returns the tagged label', () => {
    const reg = createShellRegistry();
    reg.register(makeHandle('a'));
    reg.tagVwRunner('a', 'runner');
    expect(reg.getVwLabel('a')).toBe('runner');
  });

  test('tag updates are reflected', () => {
    const reg = createShellRegistry();
    reg.register(makeHandle('a'));
    reg.tagVwRunner('a', 'runner');
    reg.tagVwRunner('a', 'deploy');
    expect(reg.getVwLabel('a')).toBe('deploy');
  });
});
