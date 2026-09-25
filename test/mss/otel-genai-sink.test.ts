// PLAN §4.6 · Arc 2.2 — OtelGenAISink tests.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  OtelGenAISink, createOtelGenAISinkFromFlags,
} from '../../src/mss/logging/index.js';
import type { LogRecord } from '../../src/mss/logging/record.js';

interface SentBatch { endpoint: string; body: string; }

function mkSink(opts: { fail?: boolean } = {}): { sink: OtelGenAISink; sent: SentBatch[] } {
  const sent: SentBatch[] = [];
  const sink = new OtelGenAISink({
    endpoint: 'http://collector:4318/v1/traces',
    batchSize: 3,
    batchIntervalMs: 50_000, // long enough that the timer never fires in the test
    send: async (endpoint, body) => {
      if (opts.fail) throw new Error('connection refused');
      sent.push({ endpoint, body });
    },
  });
  return { sink, sent };
}

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: '2026-04-27T12:00:00.000Z',
    category: 'llm.router',
    event: 'streamLLMWithTools',
    data: { provider: 'anthropic', model: 'claude-opus-4-7', usage: { input_tokens: 100, output_tokens: 50 } },
    trace_id: '01HX7K1234567890ABCDEFGHJKMNPQ',
    span_id: '01HX7K1234567890',
    ...over,
  };
}

afterEach(async () => {
  // No sink-level cleanup — each test uses its own instance and the
  // batch timer never fires (50_000 ms).
});

describe('OtelGenAISink — emit gating', () => {
  test('llm.* records are buffered', () => {
    const { sink } = mkSink();
    sink.emit(rec());
    expect(sink.bufferedCount()).toBe(1);
  });

  test('non-llm records are skipped by default', () => {
    const { sink } = mkSink();
    sink.emit(rec({ category: 'agent.spawn' }));
    expect(sink.bufferedCount()).toBe(0);
  });

  test('custom category prefix filter is honoured', () => {
    const sent: SentBatch[] = [];
    const sink = new OtelGenAISink({
      endpoint: 'x',
      batchSize: 10,
      batchIntervalMs: 999_999,
      includeCategoryPrefixes: ['agent.', 'llm.'],
      send: async (e, b) => { sent.push({ endpoint: e, body: b }); },
    });
    sink.emit(rec({ category: 'agent.spawn' }));
    sink.emit(rec({ category: 'llm.router' }));
    sink.emit(rec({ category: 'mouse.pill.hit' }));
    expect(sink.bufferedCount()).toBe(2);
  });
});

describe('OtelGenAISink — batch flush', () => {
  test('flush at batchSize sends an OTLP envelope', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec());
    sink.emit(rec());
    sink.emit(rec());
    await sink.drain();
    expect(sent.length).toBe(1);
    const env = JSON.parse(sent[0]!.body);
    expect(env.resourceSpans?.length).toBe(1);
    expect(env.resourceSpans[0].scopeSpans?.[0].spans.length).toBe(3);
  });

  test('manual flush() drains a sub-batch', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec());
    expect(sink.bufferedCount()).toBe(1);
    sink.flush();
    await sink.drain();
    expect(sent.length).toBe(1);
    expect(sink.bufferedCount()).toBe(0);
  });

  test('endpoint is forwarded verbatim', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec());
    sink.flush();
    await sink.drain();
    expect(sent[0]!.endpoint).toBe('http://collector:4318/v1/traces');
  });
});

describe('OtelGenAISink — span shape', () => {
  test('records map gen_ai.* attributes from the data payload', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec());
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    const attrs = Object.fromEntries(
      span.attributes.map((a: { key: string; value: { stringValue?: string; intValue?: string } }) =>
        [a.key, a.value.stringValue ?? a.value.intValue]),
    );
    expect(attrs['gen_ai.system']).toBe('anthropic');
    expect(attrs['gen_ai.request.model']).toBe('claude-opus-4-7');
    expect(attrs['gen_ai.usage.input_tokens']).toBe('100');
    expect(attrs['gen_ai.usage.output_tokens']).toBe('50');
    expect(attrs['gen_ai.operation.name']).toBe('streamLLMWithTools');
  });

  test('trace_id is padded to 32 hex chars', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec({ trace_id: 'abc' }));
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId.length).toBe(32);
    expect(span.traceId.endsWith('abc')).toBe(true);
  });

  test('span_id is padded to 16 hex chars', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec({ span_id: 'beef' }));
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.spanId.length).toBe(16);
    expect(span.spanId.endsWith('beef')).toBe(true);
  });

  test('parentSpanId is omitted when missing', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec({ parent_span_id: undefined }));
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.parentSpanId).toBeUndefined();
  });

  test('parentSpanId is included when present', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec({ parent_span_id: 'cafe1234' }));
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.parentSpanId).toBeDefined();
    expect(span.parentSpanId.endsWith('cafe1234')).toBe(true);
  });

  test('OpenAI-style usage keys also map', async () => {
    const { sink, sent } = mkSink();
    sink.emit(rec({
      data: {
        provider: 'openai',
        model: 'gpt-5.4',
        usage: { prompt_tokens: 200, completion_tokens: 80 },
      },
    }));
    sink.flush();
    await sink.drain();
    const span = JSON.parse(sent[0]!.body).resourceSpans[0].scopeSpans[0].spans[0];
    const attrs = Object.fromEntries(
      span.attributes.map((a: { key: string; value: { intValue?: string } }) =>
        [a.key, a.value.intValue]),
    );
    expect(attrs['gen_ai.usage.input_tokens']).toBe('200');
    expect(attrs['gen_ai.usage.output_tokens']).toBe('80');
  });
});

describe('OtelGenAISink — failure handling', () => {
  test('send failures are silent (no throw out of emit/flush)', async () => {
    const { sink } = mkSink({ fail: true });
    sink.emit(rec());
    sink.emit(rec());
    sink.emit(rec()); // triggers flush at batchSize
    await sink.drain();
    expect(sink.droppedSpans()).toBeGreaterThanOrEqual(3);
  });

  test('flush with empty buffer is a no-op', async () => {
    const { sink, sent } = mkSink();
    sink.flush();
    await sink.drain();
    expect(sent.length).toBe(0);
  });
});

describe('OtelGenAISink — resource attributes', () => {
  test('service.name + service.version land on resource', async () => {
    const sent: SentBatch[] = [];
    const sink = new OtelGenAISink({
      endpoint: 'x',
      serviceName: 'monad-test',
      serviceVersion: '1.2.3',
      batchSize: 1,
      batchIntervalMs: 999_999,
      send: async (e, b) => { sent.push({ endpoint: e, body: b }); },
    });
    sink.emit(rec());
    await sink.drain();
    const env = JSON.parse(sent[0]!.body);
    const resAttrs = Object.fromEntries(
      env.resourceSpans[0].resource.attributes.map(
        (a: { key: string; value: { stringValue?: string } }) => [a.key, a.value.stringValue],
      ),
    );
    expect(resAttrs['service.name']).toBe('monad-test');
    expect(resAttrs['service.version']).toBe('1.2.3');
  });
});

describe('createOtelGenAISinkFromFlags', () => {
  test('returns null when endpoint is unset', () => {
    expect(createOtelGenAISinkFromFlags({ otelEndpoint: undefined })).toBeNull();
  });

  test('returns null when endpoint is empty/whitespace', () => {
    expect(createOtelGenAISinkFromFlags({ otelEndpoint: '   ' })).toBeNull();
  });

  test('returns a sink when endpoint is set', () => {
    const sink = createOtelGenAISinkFromFlags({ otelEndpoint: 'http://x:4318' });
    expect(sink).not.toBeNull();
    expect(sink!.name).toBe('otel-genai');
  });

  test('forwards optional knobs', () => {
    const sink = createOtelGenAISinkFromFlags({
      otelEndpoint: 'http://x',
      otelServiceName: 'my-service',
      otelBatchSize: 10,
      otelBatchIntervalMs: 1000,
      otelServiceVersion: '0.1.0',
    });
    expect(sink).not.toBeNull();
    // The constructor parameters are not directly exposed but
    // bufferedCount starts at 0 regardless — sanity check the
    // returned instance is usable.
    expect(sink!.bufferedCount()).toBe(0);
  });
});
