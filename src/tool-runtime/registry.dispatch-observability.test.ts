import { afterEach, describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import {
  dispatchToolByName,
  registerToolRuntime,
  _unregisterToolRuntimeForTest,
} from './registry.js';
import type { ToolRuntime } from './types.js';

const PROBE_ID = 'test-dispatch-observability-probe';

afterEach(() => { _unregisterToolRuntimeForTest(PROBE_ID); });

describe('툴 «호출»을 세는 한 자리 — dispatchToolByName', () => {
  const probe = (onRun: () => void): ToolRuntime => ({
    id: PROBE_ID,
    spec: { name: PROBE_ID, description: 'probe', input_schema: { type: 'object', properties: {} } },
    run: async () => { onRun(); return { ok: true } as never; },
  } as never);

  test('⭐⭐ 호출이 «관측에» 남는다 — 이 자리가 없으면 「쓰나」를 물을 수 없다', async () => {
    const rows: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: Record<string, unknown>) => {
      rows.push({ category, event, data: data ?? {} });
    }) as typeof debug.log;
    try {
      registerToolRuntime(probe(() => {}));
      await dispatchToolByName(PROBE_ID, {}, { surface: 'cli' } as never);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    const invoked = rows.filter((r) => r.category === 'tool-runtime.dispatch' && r.event === 'invoked');
    expect(invoked).toHaveLength(1);
    expect(invoked[0]!.data).toEqual({ tool: PROBE_ID, requested: PROBE_ID, surface: 'cli' });
  });

  test('⛔ 인자를 «싣지 않는다» — 비밀이 섞이고 payload 가 커진다', async () => {
    const rows: Array<{ data: Record<string, unknown> }> = [];
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'tool-runtime.dispatch' && event === 'invoked') rows.push({ data: data ?? {} });
    }) as typeof debug.log;
    try {
      registerToolRuntime(probe(() => {}));
      await dispatchToolByName(PROBE_ID, { token: 'sk-secret-do-not-log', nested: { a: 1 } }, { surface: 'cli' } as never);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    expect(JSON.stringify(rows)).not.toContain('sk-secret-do-not-log');
    expect(Object.keys(rows[0]!.data).sort()).toEqual(['requested', 'surface', 'tool']);
  });

  test('⛔ 관측이 «죽어도» 툴 실행을 막지 않는다 (fail-open)', async () => {
    let ran = false;
    const original = debug.log;
    (debug as { log: typeof debug.log }).log = (() => { throw new Error('sink down'); }) as typeof debug.log;
    try {
      registerToolRuntime(probe(() => { ran = true; }));
      const result = await dispatchToolByName(PROBE_ID, {}, { surface: 'cli' } as never);
      // ⛔ ToolRunResult 는 유니온(`{output:string} | Record<string,unknown>`)이라 `.ok` 를 «직접» 못 읽는다.
      //   probe 가 `{ ok: true }` 를 내므로 단언 «의미»는 그대로 두고 읽는 자리만 좁힌다.
      expect((result as Record<string, unknown>).ok).toBe(true);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
    expect(ran).toBe(true);
  });
});
