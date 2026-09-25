import { describe, test, expect } from 'bun:test';
import {
  getParentSpanId,
  getSpanId,
  getTraceContext,
  getTraceId,
  newSpanId,
  startTurnTrace,
  withSpan,
  withTraceContext,
} from '../../src/mss/trace-context.js';

describe('mss trace-context', () => {
  test('outside any scope → getters return undefined', () => {
    expect(getTraceId()).toBeUndefined();
    expect(getSpanId()).toBeUndefined();
    expect(getTraceContext()).toBeUndefined();
  });

  test('startTurnTrace mints trace_id and span_id', () => {
    const captured = startTurnTrace(() => getTraceContext());
    expect(captured).toBeDefined();
    expect(captured?.trace_id).toHaveLength(26);
    expect(captured?.span_id).toHaveLength(26);
    expect(captured?.parent_span_id).toBeUndefined();
  });

  test('nested async inherits trace_id', async () => {
    const outer = startTurnTrace(async () => {
      const mine = getTraceId();
      await Promise.resolve();
      expect(getTraceId()).toBe(mine!);
      return mine;
    });
    const id = await outer;
    expect(id).toHaveLength(26);
  });

  test('withSpan creates child span linking to parent', () => {
    startTurnTrace(() => {
      const root = getTraceContext()!;
      const child = withSpan(() => getTraceContext());
      expect(child?.trace_id).toBe(root.trace_id);
      expect(child?.span_id).not.toBe(root.span_id);
      expect(child?.parent_span_id).toBe(root.span_id);
      // parent frame unchanged after withSpan exits
      expect(getSpanId()).toBe(root.span_id);
      expect(getParentSpanId()).toBeUndefined();
    });
  });

  test('withSpan outside any trace opens a fresh turn', () => {
    const ctx = withSpan(() => getTraceContext());
    expect(ctx?.trace_id).toHaveLength(26);
    expect(ctx?.span_id).toHaveLength(26);
  });

  test('withTraceContext bridges an external trace_id', () => {
    const imported = { trace_id: 'EXTERNAL0000000000000000AB', span_id: 'EXTERNAL0000000000000000CD' };
    const seen = withTraceContext(imported, () => getTraceContext());
    expect(seen).toEqual(imported);
  });

  test('sibling scopes are isolated', () => {
    const a = startTurnTrace(() => getTraceId());
    const b = startTurnTrace(() => getTraceId());
    expect(a).not.toBe(b);
    expect(getTraceId()).toBeUndefined();
  });

  test('newSpanId mints without mutating storage', () => {
    startTurnTrace(() => {
      const s = getSpanId();
      const fresh = newSpanId();
      expect(fresh).toHaveLength(26);
      expect(fresh).not.toBe(s);
      expect(getSpanId()).toBe(s!);
    });
  });
});
