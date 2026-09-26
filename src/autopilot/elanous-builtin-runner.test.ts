// src/autopilot/elanous-builtin-runner.test.ts
//
// ROADMAP-elanous-builtin §MB-3 — ElanousBuiltinTurnRunner unit tests.
//
// 본 scope = 어댑터 wiring (block conversion · stop reason mapping ·
// system prompt prepend · history accumulation · cancel). 실제 LLM
// round-trip 은 MB-6 dogfood 가 검증 — 본 test 는 pre-abort signal
// trick 으로 runCoreTurn 의 early-return path 만 exercise.
//
// Stop-reason *behavior* through `prompt()` is the integration file's
// mock seam. This file keeps the real `runCoreTurn` import so the
// existing init / cancel / history / block tests still exercise the
// live runner path. The mapping helper is a pure function and is
// asserted here without replacing that import.

import { describe, test, expect } from 'bun:test';
import {
  mapCoreTurnStopReason,
  ElanousBuiltinTurnRunner,
} from './elanous-builtin-runner.js';
import type { CoreTurnDispatchTool, CoreTurnStopReason } from '../core-turn/types.js';
import type { ContentBlock, StopReason } from '@agentclientprotocol/sdk';

function noopDispatch(): CoreTurnDispatchTool {
  return async () => ({ output: 'noop' });
}

describe('ElanousBuiltinTurnRunner — initialization', () => {
  test('systemPrompt prepended as system message', () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-init-1',
      tools: [],
      dispatchTool: noopDispatch(),
      systemPrompt: 'You are an autopilot.',
    });
    const hist = runner._getHistoryForTesting();
    expect(hist).toHaveLength(1);
    expect(hist[0].role).toBe('system');
    expect(hist[0].content).toBe('You are an autopilot.');
  });

  test('no systemPrompt → empty history', () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-init-2',
      tools: [],
      dispatchTool: noopDispatch(),
    });
    expect(runner._getHistoryForTesting()).toHaveLength(0);
  });

  test('empty systemPrompt → no system message added', () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-init-3',
      tools: [],
      dispatchTool: noopDispatch(),
      systemPrompt: '',
    });
    expect(runner._getHistoryForTesting()).toHaveLength(0);
  });
});

describe('ElanousBuiltinTurnRunner — prompt cancel wiring', () => {
  test('pre-aborted cancel → cancelled stopReason · user block added', async () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-cancel-1',
      tools: [],
      dispatchTool: noopDispatch(),
    });
    // Pre-abort by calling cancel() before prompt() races runCoreTurn.
    // Actually cancel() requires an in-flight abortController; instead
    // we abort mid-flight via the same controller wiring: we initiate
    // prompt() and abort it after the synchronous setup but before LLM
    // dispatch by chaining a microtask. The simpler form here is to
    // pass blocks then call cancel() which races runCoreTurn's
    // pre-flight signal.aborted check.
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello' }];
    const promptPromise = runner.prompt(blocks, () => {});
    // Cancel on the next microtask — runCoreTurn's first line
    // `if (ctx.signal.aborted) return { stopReason: 'aborted', ... }`
    // fires when we abort before streamLLMWithTools' first await.
    await runner.cancel();
    const result = await promptPromise;
    expect(['cancelled', 'end_turn']).toContain(result.stopReason);
    // History has the user block regardless of cancel timing.
    const hist = runner._getHistoryForTesting();
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[hist.length - 1].role).toBe('user');
  });

  test('multi-iteration history accumulates user blocks', async () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-multi-1',
      tools: [],
      dispatchTool: noopDispatch(),
      systemPrompt: 'sys',
    });
    // Two iterations · each pre-cancelled so we just verify the user
    // block is captured.
    await Promise.resolve(); // microtask boundary
    const p1 = runner.prompt([{ type: 'text', text: 'iter1' }], () => {});
    await runner.cancel();
    await p1;

    const p2 = runner.prompt([{ type: 'text', text: 'iter2' }], () => {});
    await runner.cancel();
    await p2;

    const hist = runner._getHistoryForTesting();
    // system + user(iter1) + user(iter2) at minimum (runCoreTurn may
    // have early-returned without appending assistant messages)
    expect(hist.length).toBeGreaterThanOrEqual(3);
    expect(hist[0].role).toBe('system');
    const userMessages = hist.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0].content).toBe('iter1');
    expect(userMessages[1].content).toBe('iter2');
  });
});

describe('ElanousBuiltinTurnRunner — block conversion', () => {
  test('text block converts to plain-string user content', async () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-conv-1',
      tools: [],
      dispatchTool: noopDispatch(),
    });
    const p = runner.prompt([{ type: 'text', text: 'hello world' }], () => {});
    await runner.cancel();
    await p;
    const hist = runner._getHistoryForTesting();
    const lastUser = [...hist].reverse().find((m) => m.role === 'user');
    expect(lastUser?.content).toBe('hello world');
  });

  test('image block produces ContentBlock[] user content', async () => {
    const runner = new ElanousBuiltinTurnRunner({
      sessionId: 'sid-conv-2',
      tools: [],
      dispatchTool: noopDispatch(),
    });
    const p = runner.prompt(
      [
        { type: 'image', data: 'iVBORw==', mimeType: 'image/png' } as ContentBlock,
        { type: 'text', text: 'describe this' },
      ],
      () => {},
    );
    await runner.cancel();
    await p;
    const hist = runner._getHistoryForTesting();
    const lastUser = [...hist].reverse().find((m) => m.role === 'user');
    // Mixed text + image → array (not flattened string)
    expect(Array.isArray(lastUser?.content)).toBe(true);
  });
});

// Completeness latch: a new CoreTurnStopReason member is a type error
// here (and in mapCoreTurnStopReason's never-default) instead of a
// silent end_turn fallback.
const EXPECTED_ACP_STOP: { [K in CoreTurnStopReason]: StopReason } = {
  end_turn: 'end_turn',
  max_turns: 'max_turn_requests',
  aborted: 'cancelled',
  error: 'refusal',
  auth_rejected: 'refusal',
};

describe('ElanousBuiltinTurnRunner — core-turn stopReason mapping', () => {
  test('maps every CoreTurnStopReason onto the expected ACP stop reason', () => {
    const reasons = Object.keys(EXPECTED_ACP_STOP) as CoreTurnStopReason[];
    expect(reasons).toHaveLength(5);
    for (const reason of reasons) {
      expect(mapCoreTurnStopReason(reason)).toBe(EXPECTED_ACP_STOP[reason]);
    }
  });

  test('aborted → cancelled', () => {
    expect(mapCoreTurnStopReason('aborted')).toBe('cancelled');
  });

  test('max_turns → max_turn_requests', () => {
    expect(mapCoreTurnStopReason('max_turns')).toBe('max_turn_requests');
  });

  test('error → refusal', () => {
    expect(mapCoreTurnStopReason('error')).toBe('refusal');
  });

  test('end_turn → end_turn', () => {
    expect(mapCoreTurnStopReason('end_turn')).toBe('end_turn');
  });

  test('auth_rejected → refusal · not a successful end_turn', () => {
    const mapped = mapCoreTurnStopReason('auth_rejected');
    expect(mapped).not.toBe('end_turn');
    expect(mapped).toBe('refusal');
  });

  test('unknown core stop reason does not fall through to end_turn', () => {
    // Runtime latch for the default branch: restoring the old
    // "everything else → end_turn" fallback fails this test.
    const unknown = 'future_reason' as CoreTurnStopReason;
    expect(mapCoreTurnStopReason(unknown)).not.toBe('end_turn');
  });
});
