// ── core-hooks-bootstrap ──

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  bootstrapCoreHooks,
  isCoreHooksBootstrappedForTest,
  resetCoreHooksBootstrapForTest,
} from '../src/plugin-hooks/bootstrap';
import { globalHookDispatcher } from '../src/plugin-hooks/dispatcher';
import { buildAndonTurnHook } from '../src/cft/andon-turn-hook';
import {
  clearAllEscalationsForTest,
  emitEscalation,
} from '../src/cft/andon';

beforeEach(() => {
  resetCoreHooksBootstrapForTest();
  clearAllEscalationsForTest();
});

afterEach(() => {
  resetCoreHooksBootstrapForTest();
});

describe('bootstrapCoreHooks', () => {
  test('registers 3 core Turn hooks', () => {
    bootstrapCoreHooks();
    const hooks = globalHookDispatcher.list('Turn');
    const ids = hooks.map((h) => h.id).sort();
    expect(ids).toEqual(['core:andon', 'core:missions', 'core:route-banner']);
  });

  test('idempotent — second call does not duplicate', () => {
    bootstrapCoreHooks();
    const count = globalHookDispatcher.list('Turn').length;
    bootstrapCoreHooks();
    expect(globalHookDispatcher.list('Turn').length).toBe(count);
  });

  test('isCoreHooksBootstrappedForTest flips', () => {
    expect(isCoreHooksBootstrappedForTest()).toBe(false);
    bootstrapCoreHooks();
    expect(isCoreHooksBootstrappedForTest()).toBe(true);
  });

  test('reset allows re-bootstrap', () => {
    bootstrapCoreHooks();
    resetCoreHooksBootstrapForTest();
    expect(isCoreHooksBootstrappedForTest()).toBe(false);
    bootstrapCoreHooks();
    expect(isCoreHooksBootstrappedForTest()).toBe(true);
  });

  test('registered hooks preserve their priority order', () => {
    bootstrapCoreHooks();
    const hooks = globalHookDispatcher.list('Turn').filter((h) =>
      ['core:andon', 'core:route-banner', 'core:missions'].includes(h.id),
    );
    const byPrio = [...hooks].sort((a, b) => a.priority - b.priority).map((h) => h.id);
    expect(byPrio).toEqual(['core:andon', 'core:route-banner', 'core:missions']);
  });
});

describe('buildAndonTurnHook', () => {
  test('returns empty when no CRITICAL', async () => {
    const hook = buildAndonTurnHook();
    const out = await hook.invoke({
      turnNumber: 1,
      messages: [],
      systemPrompt: '',
      tools: [],
    }, {} as any);
    expect(out).toEqual({});
  });

  test('returns systemPromptInject when CRITICAL pending', async () => {
    await emitEscalation(
      { agentId: 'a', severity: 'CRITICAL', reason: 'r' },
      { skipObsidian: true },
    );
    const hook = buildAndonTurnHook();
    const out = await hook.invoke({
      turnNumber: 1,
      messages: [],
      systemPrompt: '',
      tools: [],
    }, {} as any);
    expect((out as any).systemPromptInject).toContain('ANDON');
    expect((out as any).systemPromptInject).toContain('[a]');
  });

  test('HIGH alone does not produce preamble (CRITICAL-gated)', async () => {
    await emitEscalation(
      { agentId: 'a', severity: 'HIGH', reason: 'r' },
      { skipObsidian: true },
    );
    const hook = buildAndonTurnHook();
    const out = await hook.invoke({
      turnNumber: 1,
      messages: [],
      systemPrompt: '',
      tools: [],
    }, {} as any);
    expect(out).toEqual({});
  });

  test('handler id is core:andon with priority 2', () => {
    const hook = buildAndonTurnHook();
    expect(hook.id).toBe('core:andon');
    expect(hook.priority).toBe(2);
    expect(hook.event).toBe('Turn');
  });
});

describe('dispatch integration — Turn output includes Andon inject', () => {
  test('dispatcher merges andon inject into Turn output', async () => {
    bootstrapCoreHooks();
    await emitEscalation(
      { agentId: 'dispatch-test', severity: 'CRITICAL', reason: 'end-to-end' },
      { skipObsidian: true },
    );
    const outcome = await globalHookDispatcher.dispatch('Turn', {
      turnNumber: 1,
      messages: [],
      systemPrompt: '',
      tools: [],
    });
    expect(outcome.abort).toBeUndefined();
    const inject = outcome.output.systemPromptInject ?? '';
    expect(inject).toContain('ANDON');
    expect(inject).toContain('[dispatch-test]');
  });
});
