import { afterEach, describe, expect, test } from 'bun:test';
import {
  subscribeEditResult,
  subscribeSourceDelta,
  publishEditResult,
  _clearEditResultListenersForTesting,
  _setSourceDeltaManagerForTesting,
  SourceDeltaManager,
  type EditResult,
} from '../../src/code-edit/index.js';

afterEach(() => {
  _clearEditResultListenersForTesting();
  _setSourceDeltaManagerForTesting(null);
});

function fake(path: string): EditResult {
  return {
    ok: true,
    file_path: path,
    structuredPatch: [],
    originalContent: 'a',
    newContent: 'b',
    edits: [{ old_string: 'a', new_string: 'b' }],
    linesAdded: 1,
    linesRemoved: 1,
  };
}

describe('subscribeEditResult / publishEditResult', () => {
  test('subscriber receives published results', () => {
    const seen: string[] = [];
    subscribeEditResult((r) => seen.push(r.file_path));
    publishEditResult(fake('/a'));
    publishEditResult(fake('/b'));
    expect(seen).toEqual(['/a', '/b']);
  });

  test('dispose removes only that subscriber', () => {
    const a: string[] = [];
    const b: string[] = [];
    const disposeA = subscribeEditResult((r) => a.push(r.file_path));
    subscribeEditResult((r) => b.push(r.file_path));

    publishEditResult(fake('/x'));
    expect(a).toEqual(['/x']);
    expect(b).toEqual(['/x']);

    disposeA();
    publishEditResult(fake('/y'));
    expect(a).toEqual(['/x']);
    expect(b).toEqual(['/x', '/y']);
  });

  test('a throwing subscriber does not break the others', () => {
    const ok: string[] = [];
    subscribeEditResult(() => { throw new Error('boom'); });
    subscribeEditResult((r) => ok.push(r.file_path));
    expect(() => publishEditResult(fake('/z'))).not.toThrow();
    expect(ok).toEqual(['/z']);
  });

  test('source-delta subscribers receive normalized aggregate state', () => {
    _setSourceDeltaManagerForTesting(new SourceDeltaManager());
    const seen: string[] = [];
    subscribeSourceDelta((event) => seen.push(`${event.turnIndex}:${event.file.filePath}:${event.turn.stats.edits}`));
    publishEditResult(fake('/delta.ts'));
    publishEditResult(fake('/delta.ts'));
    expect(seen).toEqual([
      '1:/delta.ts:1',
      '1:/delta.ts:2',
    ]);
  });

  test('_clearEditResultListenersForTesting drops everything', () => {
    const seen: number[] = [];
    subscribeEditResult(() => seen.push(1));
    _clearEditResultListenersForTesting();
    publishEditResult(fake('/after-clear'));
    expect(seen).toEqual([]);
  });
});
