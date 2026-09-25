import { describe, expect, test } from 'bun:test';
import { writePtyWithOutcome } from './pty-write-outcome.js';
import type { PtyHandle } from './registry.js';

function handle(canWrite: boolean, write: () => void): PtyHandle {
  return { canWrite: () => canWrite, write } as unknown as PtyHandle;
}

describe('writePtyWithOutcome', () => {
  test('preserves success, denied, and write-failed outcomes without event listeners', () => {
    let writes = 0;
    expect(writePtyWithOutcome(handle(true, () => { writes++; }), 'ok')).toBe('success');
    expect(writes).toBe(1);
    expect(writePtyWithOutcome(handle(false, () => { writes++; }), 'blocked')).toBe('denied');
    expect(writes).toBe(1);
    expect(writePtyWithOutcome(handle(true, () => { throw new Error('closed'); }), 'failed')).toBe('write-failed');
  });
});
