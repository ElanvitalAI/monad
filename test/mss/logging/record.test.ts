import { describe, test, expect } from 'bun:test';
import { fromJsonl, LOG_LEVEL_ORDER, toJsonl, type LogRecord } from '../../../src/mss/logging/record.js';

describe('mss log/record', () => {
  test('toJsonl → fromJsonl round-trip preserves every field', () => {
    const rec: LogRecord = {
      ts: '2026-04-24T12:34:56.789Z',
      category: 'pfc.classify',
      event: 'dispatch',
      data: { domain: 'coding', consumed: true },
      level: 'info',
      trace_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      span_id: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
      parent_span_id: '01ARZ3NDEKTSV4RRFFQ69G5FA3',
      monad_id: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
      source: { file: 'src/conductor/classify.ts', line: 142, fn: 'classify' },
      pid: 1234,
    };
    const line = toJsonl(rec);
    expect(line).not.toContain('\n');
    const back = fromJsonl(line);
    expect(back).toEqual(rec);
  });

  test('fromJsonl — malformed line returns null', () => {
    expect(fromJsonl('')).toBeNull();
    expect(fromJsonl('   ')).toBeNull();
    expect(fromJsonl('not json at all')).toBeNull();
    expect(fromJsonl('{"incomplete": "')).toBeNull();
  });

  test('fromJsonl — missing required field returns null', () => {
    expect(fromJsonl(JSON.stringify({ category: 'a', event: 'b' }))).toBeNull(); // no ts
    expect(fromJsonl(JSON.stringify({ ts: 't', event: 'b' }))).toBeNull(); // no category
    expect(fromJsonl(JSON.stringify({ ts: 't', category: 'c' }))).toBeNull(); // no event
  });

  test('fromJsonl — minimal required fields accepted', () => {
    const line = JSON.stringify({ ts: 't', category: 'c', event: 'e' });
    const rec = fromJsonl(line);
    expect(rec?.ts).toBe('t');
    expect(rec?.trace_id).toBeUndefined();
  });

  test('LOG_LEVEL_ORDER monotonic', () => {
    expect(LOG_LEVEL_ORDER.trace).toBeLessThan(LOG_LEVEL_ORDER.debug);
    expect(LOG_LEVEL_ORDER.debug).toBeLessThan(LOG_LEVEL_ORDER.info);
    expect(LOG_LEVEL_ORDER.info).toBeLessThan(LOG_LEVEL_ORDER.warn);
    expect(LOG_LEVEL_ORDER.warn).toBeLessThan(LOG_LEVEL_ORDER.error);
    expect(LOG_LEVEL_ORDER.error).toBeLessThan(LOG_LEVEL_ORDER.critical);
  });
});
