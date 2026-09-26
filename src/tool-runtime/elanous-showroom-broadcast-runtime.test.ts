// PLAN-codex-app-server-hermes-parity §5 Phase H1·6a test —
// dispatchElanousShowroomBroadcast args parsing + broadcaster injection.

import { describe, test, expect } from 'bun:test';
import {
  dispatchElanousShowroomBroadcast,
  elanousShowroomBroadcastRuntime,
  buildElanousShowroomBroadcastTool,
} from './elanous-showroom-broadcast-runtime.js';
import type { BroadcastInvocation, BroadcastResult } from '../showroom/daemon-broadcast.js';

function stubBroadcaster(
  invocations: BroadcastInvocation[],
  result?: Partial<BroadcastResult>,
): (inv: BroadcastInvocation) => Promise<BroadcastResult> {
  return async (inv) => {
    invocations.push(inv);
    return {
      prompt: inv.prompt,
      targets: inv.backends.map((b) => ({
        backend: b,
        ok: true,
        response: `from ${b}`,
        stopReason: 'end_turn',
        durationMs: 1,
      })),
      okCount: inv.backends.length,
      failCount: 0,
      ...result,
    };
  };
}

describe('dispatchElanousShowroomBroadcast · input validation', () => {
  test('missing prompt → output indicates required + empty targets', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      {},
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(r.output).toContain('prompt required');
    expect(r.targets).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('whitespace-only prompt → same path', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      { prompt: '   ' },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(r.output).toContain('prompt required');
    expect(calls).toHaveLength(0);
  });

  test('empty backends array → falls back to default trio', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      { prompt: 'hi', backends: [] },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(calls[0]!.backends).toEqual(['claude', 'gemini', 'grok']);
    expect(r.okCount).toBe(3);
  });
});

describe('dispatchElanousShowroomBroadcast · happy path', () => {
  test('forwards prompt + default backends', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      { prompt: 'refactor this' },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(calls[0]!.prompt).toBe('refactor this');
    expect(calls[0]!.backends).toEqual(['claude', 'gemini', 'grok']);
    expect(r.targets).toHaveLength(3);
    expect(r.output).toContain('3/3 backends responded');
  });

  test('honors custom backends + cwd + timeout', async () => {
    const calls: BroadcastInvocation[] = [];
    await dispatchElanousShowroomBroadcast(
      {
        prompt: 'x',
        backends: ['claude', 'codex-app-server'],
        cwd: '/tmp/work',
        timeoutMs: 60_000,
      },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(calls[0]!.backends).toEqual(['claude', 'codex-app-server']);
    expect(calls[0]!.cwd).toBe('/tmp/work');
    expect(calls[0]!.timeoutMs).toBe(60_000);
  });

  test('summary reflects partial failures', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      { prompt: 'hi', backends: ['a', 'b', 'c'] },
      {
        broadcaster: stubBroadcaster(calls, {
          okCount: 2,
          failCount: 1,
          targets: [
            { backend: 'a', ok: true, response: 'A', stopReason: 'end_turn', durationMs: 1 },
            { backend: 'b', ok: true, response: 'B', stopReason: 'end_turn', durationMs: 1 },
            { backend: 'c', ok: false, error: 'boom', durationMs: 1 },
          ],
        }),
      },
    );
    expect(r.output).toContain('2/3 backends responded');
    expect(r.output).toContain('1 failed');
  });
});

describe('dispatchElanousShowroomBroadcast · backend filtering', () => {
  test('drops non-string / empty backend entries', async () => {
    const calls: BroadcastInvocation[] = [];
    await dispatchElanousShowroomBroadcast(
      {
        prompt: 'hi',
        backends: ['claude', '' as string, null as unknown as string, 'grok'],
      },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(calls[0]!.backends).toEqual(['claude', 'grok']);
  });

  test('all backends invalid → no broadcaster call + helpful output', async () => {
    const calls: BroadcastInvocation[] = [];
    const r = await dispatchElanousShowroomBroadcast(
      { prompt: 'hi', backends: ['', null as unknown as string] },
      { broadcaster: stubBroadcaster(calls) },
    );
    expect(calls).toHaveLength(0);
    expect(r.output).toContain('no valid backends');
  });
});

describe('elanousShowroomBroadcastRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousShowroomBroadcastRuntime.id).toBe('elanous_showroom_broadcast');
    expect(elanousShowroomBroadcastRuntime.spec.name).toBe('elanous_showroom_broadcast');
  });

  test('buildElanousShowroomBroadcastTool requires prompt + lists default backends', () => {
    const spec = buildElanousShowroomBroadcastTool();
    const params = spec.parameters as { required?: string[] };
    expect(params.required).toContain('prompt');
  });
});
