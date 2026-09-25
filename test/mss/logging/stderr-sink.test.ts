// ── StderrSink tests (MSS M2.2 Phase A2) ──
//
// The sink's direct behaviour is exercised here via the `write` injection
// override so we never actually scribble on real stderr during the suite.
// Integration with the `debug` singleton (opt-in wire-up via feature flags)
// is covered implicitly by `debug-log.test.ts` — those tests show that
// default-off keeps the ring buffer clean.

import { describe, expect, test } from 'bun:test';

import { StderrSink, createStderrSinkFromFlags } from '../../../src/mss/logging/sinks/stderr-sink.ts';
import type { LogRecord } from '../../../src/mss/logging/record.ts';

function mkRec(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: new Date().toISOString(),
    category: 'test',
    event: 'ev',
    ...overrides,
  };
}

describe('StderrSink · basic dispatch', () => {
  test('emit serialises the record as NDJSON and appends newline', () => {
    const lines: string[] = [];
    const sink = new StderrSink({ write: (l) => lines.push(l) });
    sink.emit(mkRec({ category: 'llm', event: 'req' }));
    expect(lines.length).toBe(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    const parsed = JSON.parse(lines[0].trim());
    expect(parsed.category).toBe('llm');
    expect(parsed.event).toBe('req');
  });

  test('write failures are absorbed silently', () => {
    const sink = new StderrSink({ write: () => { throw new Error('pipe closed'); } });
    expect(() => sink.emit(mkRec())).not.toThrow();
  });
});

describe('StderrSink · level filter', () => {
  test('no filter passes every record', () => {
    const lines: string[] = [];
    const sink = new StderrSink({ write: (l) => lines.push(l) });
    sink.emit(mkRec({ level: 'trace', event: 't' }));
    sink.emit(mkRec({ level: 'debug', event: 'd' }));
    sink.emit(mkRec({ level: 'error', event: 'e' }));
    expect(lines.length).toBe(3);
  });

  test('minLevel=warn drops trace/debug/info', () => {
    const lines: string[] = [];
    const sink = new StderrSink({ minLevel: 'warn', write: (l) => lines.push(l) });
    sink.emit(mkRec({ level: 'trace', event: 't' }));
    sink.emit(mkRec({ level: 'debug', event: 'd' }));
    sink.emit(mkRec({ level: 'info', event: 'i' }));
    sink.emit(mkRec({ level: 'warn', event: 'w' }));
    sink.emit(mkRec({ level: 'error', event: 'e' }));
    expect(lines.map(l => JSON.parse(l.trim()).event)).toEqual(['w', 'e']);
  });

  test('record without level is treated as debug', () => {
    const lines: string[] = [];
    const sink = new StderrSink({ minLevel: 'info', write: (l) => lines.push(l) });
    sink.emit(mkRec({ event: 'no-level' }));
    sink.emit(mkRec({ level: 'info', event: 'at-info' }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0].trim()).event).toBe('at-info');
  });

  test('minLevel=critical emits only critical', () => {
    const lines: string[] = [];
    const sink = new StderrSink({ minLevel: 'critical', write: (l) => lines.push(l) });
    sink.emit(mkRec({ level: 'error', event: 'e' }));
    sink.emit(mkRec({ level: 'critical', event: 'c' }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0].trim()).event).toBe('c');
  });
});

describe('createStderrSinkFromFlags', () => {
  test('returns null when flag is off', () => {
    expect(createStderrSinkFromFlags({ stderrSink: false, stderrSinkLevel: undefined })).toBeNull();
    expect(createStderrSinkFromFlags({ stderrSink: false, stderrSinkLevel: 'warn' })).toBeNull();
  });

  test('returns a sink when flag is on', () => {
    const sink = createStderrSinkFromFlags({ stderrSink: true, stderrSinkLevel: undefined });
    expect(sink).not.toBeNull();
    expect(sink?.name).toBe('stderr');
  });

  test('level filter round-trips through the flag shape', () => {
    const lines: string[] = [];
    const sink = createStderrSinkFromFlags({ stderrSink: true, stderrSinkLevel: 'error' });
    // Replace the writer to capture emitted lines.
    // @ts-expect-error — test introspection into private field.
    sink!._write = (l: string) => lines.push(l);
    sink!.emit(mkRec({ level: 'warn', event: 'w' }));
    sink!.emit(mkRec({ level: 'error', event: 'e' }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0].trim()).event).toBe('e');
  });
});
