import { afterEach, describe, expect, test } from 'bun:test';
import { mintPtyId, ptyKindOf, resetForTesting, setPtyAdapterForTesting, startPty, type StartOpts } from './registry.js';
import { ptyIdSeparatorIndex, resolvePtyRef } from './pty-ref.js';

function stubAdapter() {
  return {
    pid: 1,
    write() {},
    kill() {},
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
  };
}

afterEach(() => {
  resetForTesting();
  setPtyAdapterForTesting(null);
});

describe('PTY ID separator compatibility', () => {
  test('uses the first underscore or hyphen consistently for kind and suffix resolution', () => {
    expect(ptyIdSeparatorIndex('codex_a3f2')).toBe(5);
    expect(ptyIdSeparatorIndex('codex-a3f2')).toBe(5);
    expect(ptyIdSeparatorIndex('codex-a3_f2')).toBe(5);
    expect(ptyKindOf('codex_a3f2')).toBe('codex');
    expect(ptyKindOf('codex-a3f2')).toBe('codex');

    const items = [
      { id: 'codex_a3f2b1c4', kind: 'codex' },
      { id: 'shell-11223344', kind: 'shell' },
      { id: 'mix-a3_f2b1c4', kind: 'mix' },
    ];
    expect(resolvePtyRef('a3f2', items).match?.id).toBe('codex_a3f2b1c4');
    expect(resolvePtyRef('1122', items).match?.id).toBe('shell-11223344');
    expect(resolvePtyRef('a3_f2', items).match?.id).toBe('mix-a3_f2b1c4');
  });

  test('preserves separator-free and colon namespace handling', () => {
    expect(ptyIdSeparatorIndex('codex')).toBe(-1);
    expect(ptyIdSeparatorIndex('codex:a3f2b1c4')).toBe(-1);
    expect(ptyKindOf('codex')).toBe('pty');
    expect(ptyKindOf('codex:a3f2b1c4')).toBe('pty');
  });

  test('accepts underscore and hyphen preallocated canonical IDs but rejects colon IDs', () => {
    setPtyAdapterForTesting(() => stubAdapter());
    expect(() => startPty({ id: 'codex_a3f2b1c4', kind: 'codex', cmd: 'x', detach: true } as StartOpts)).not.toThrow();
    expect(() => startPty({ id: 'shell-11223344', kind: 'shell', cmd: 'x', detach: true } as StartOpts)).not.toThrow();
    expect(() => startPty({ id: 'a-b_a3f2b1c4', kind: 'a-b', cmd: 'x', detach: true } as StartOpts)).not.toThrow();
    expect(() => startPty({ id: 'codex:a3f2b1c4', kind: 'codex', cmd: 'x', detach: true } as StartOpts))
      .toThrow(/invalid preallocated PTY id/);
  });

  test('requires an exact literal kind prefix for preallocated IDs', () => {
    setPtyAdapterForTesting(() => stubAdapter());
    expect(() => startPty({ id: 'ab_a3f2b1c4', kind: 'a-b', cmd: 'x', detach: true } as StartOpts))
      .toThrow(/invalid preallocated PTY id/);
  });

  test('continues minting underscore IDs', () => {
    expect(mintPtyId('codex')).toMatch(/^codex_[0-9a-f]{8}$/);
  });
});
