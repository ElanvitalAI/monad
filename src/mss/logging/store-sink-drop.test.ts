import { describe, expect, it } from 'bun:test';

import { LogStore, StoreSink } from './log-store.js';
import type { LogRecord } from './record.js';

function rec(event: string): LogRecord {
  return {
    ts: new Date().toISOString(),
    category: 'voice.stt.openai',
    event,
  };
}

describe('StoreSink drop observation', () => {
  it('counts a detached batch dropped after insert failure without throwing or retrying', () => {
    const store = new LogStore(':memory:');
    const sink = new StoreSink(store, 'nexus');
    store.close();

    sink.emit(rec('lost-on-flush'));
    expect(() => sink.flush()).not.toThrow();

    expect(sink.pending).toBe(0);
    expect(sink.dropped).toEqual({ total: 1, flushFailure: 1, bufferCap: 0 });
  });

  it('counts only the oldest records evicted by the buffer cap', () => {
    const store = new LogStore(':memory:');
    const sink = new StoreSink(store, 'nexus', {
      bufferCap: 2,
      flushBatchSize: 100,
      flushIntervalMs: 60_000,
    });

    sink.emit(rec('first'));
    sink.emit(rec('second'));
    sink.emit(rec('third'));

    expect(sink.pending).toBe(2);
    expect(sink.dropped).toEqual({ total: 1, flushFailure: 0, bufferCap: 1 });
    sink.flush();
    expect(store.recent(2).map((row) => row.event).sort()).toEqual(['second', 'third']);
    store.close();
  });

  it('does not count logs categories because the self-reference guard still rejects them', () => {
    const store = new LogStore(':memory:');
    const sink = new StoreSink(store, 'nexus', { bufferCap: 1 });

    sink.emit({ ...rec('drop'), category: 'logs.store' });

    expect(sink.pending).toBe(0);
    expect(sink.dropped).toEqual({ total: 0, flushFailure: 0, bufferCap: 0 });
    store.close();
  });
});
