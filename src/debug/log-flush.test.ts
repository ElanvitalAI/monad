import { describe, expect, it } from 'bun:test';

import { debug } from './log.js';
import type { LogSink } from '../mss/logging/sink.js';

describe('DebugLog.flush — registered sinks', () => {
  it('flushes optional sink methods, isolates failures, and preserves unregister', () => {
    const calls: string[] = [];
    const withoutFlush: LogSink = { name: 'without-flush', emit: () => {} };
    const throwing: LogSink = {
      name: 'throwing',
      emit: () => {},
      flush: () => {
        calls.push('throwing');
        throw new Error('flush failed');
      },
    };
    const succeeding: LogSink = {
      name: 'succeeding',
      emit: () => {},
      flush: () => { calls.push('succeeding'); },
    };

    const offWithoutFlush = debug.registerSink(withoutFlush);
    const offThrowing = debug.registerSink(throwing);
    const offSucceeding = debug.registerSink(succeeding);
    try {
      expect(() => debug.flush()).not.toThrow();
      expect(calls).toEqual(['throwing', 'succeeding']);

      offSucceeding();
      calls.length = 0;
      debug.flush();
      expect(calls).toEqual(['throwing']);
    } finally {
      offSucceeding();
      offThrowing();
      offWithoutFlush();
    }
  });
});
