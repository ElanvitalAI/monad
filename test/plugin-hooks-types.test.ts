// ── PX-3 P1: Hook event types + HookHandler contract ──
//
// The events + types modules are pure type+constant code (no runtime
// dispatch logic). We cover: event enumeration, isHookEvent type
// guard, priority constants, and the shape of a handler object. The
// actual dispatcher mechanics live in P2's test file.

import { describe, test, expect } from 'bun:test';
import {
  ALL_HOOK_EVENTS,
  isHookEvent,
  type HookEvent,
  type TurnHookInput,
  type MessageHookOutput,
  type ToolCallHookOutput,
  type SubagentSpawnHookOutput,
} from '../src/plugin-hooks/events';
import {
  DEFAULT_PRIORITY,
  DEFAULT_TIMEOUT_MS,
  RESERVED_PRIORITY_MAX,
  type HookHandler,
} from '../src/plugin-hooks/types';

describe('Hook event taxonomy', () => {
  test('ALL_HOOK_EVENTS lists the five shipped events', () => {
    expect([...ALL_HOOK_EVENTS].sort()).toEqual(
      ['Message', 'StateRestore', 'SubagentSpawn', 'ToolCall', 'Turn'],
    );
  });

  test('ALL_HOOK_EVENTS is frozen', () => {
    expect(Object.isFrozen(ALL_HOOK_EVENTS)).toBe(true);
  });

  test('isHookEvent — accepts valid, rejects unknown', () => {
    for (const e of ALL_HOOK_EVENTS) expect(isHookEvent(e)).toBe(true);
    expect(isHookEvent('UserPromptSubmit')).toBe(false);
    expect(isHookEvent('')).toBe(false);
    expect(isHookEvent(null)).toBe(false);
    expect(isHookEvent(123)).toBe(false);
  });
});

describe('Priority + timeout constants', () => {
  test('reserved range 0-9, default 100', () => {
    expect(RESERVED_PRIORITY_MAX).toBe(9);
    expect(DEFAULT_PRIORITY).toBe(100);
    expect(DEFAULT_PRIORITY).toBeGreaterThan(RESERVED_PRIORITY_MAX);
  });

  test('default timeout is 2 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(2000);
  });
});

describe('HookHandler shape', () => {
  test('compiles + carries generic event param through In/Out', () => {
    // The point of this test is type-level: if the shape drifts, the
    // type-checker fires on build. At runtime we just round-trip the
    // fields to ensure the handler object is constructible.
    const h: HookHandler<'Turn'> = {
      id: 'test:turn',
      event: 'Turn',
      priority: 50,
      async invoke(input: TurnHookInput) {
        return {
          systemPromptInject: `turn=${input.turnNumber}`,
        };
      },
    };
    expect(h.id).toBe('test:turn');
    expect(h.event).toBe('Turn');
    expect(h.priority).toBe(50);
  });

  test('ToolCall output union (modifyInput / deny / allow) fits', () => {
    const deny: ToolCallHookOutput = { deny: { reason: 'budget' } };
    const modify: ToolCallHookOutput = { modifyInput: { path: 'x' } };
    const allow: ToolCallHookOutput = { allow: true };
    expect(deny.deny?.reason).toBe('budget');
    expect(modify.modifyInput).toEqual({ path: 'x' });
    expect(allow.allow).toBe(true);
  });

  test('SubagentSpawn overrideDefinition accepts partial AgentDefinition', () => {
    const out: SubagentSpawnHookOutput = {
      overrideDefinition: { model: 'claude-opus-4-7' },
    };
    expect(out.overrideDefinition?.model).toBe('claude-opus-4-7');
  });

  test('Message output fields optional', () => {
    const empty: MessageHookOutput = {};
    const full: MessageHookOutput = {
      followupMessages: [{ role: 'user', content: 'ping' }],
      redirectTo: { kind: 'agent', id: 'critic' },
    };
    expect(empty.followupMessages).toBeUndefined();
    expect(full.redirectTo?.id).toBe('critic');
  });
});

describe('Unknown HookEvent rejection', () => {
  test('isHookEvent filters a mixed array', () => {
    const raw = ['Turn', 'bogus', 'ToolCall', 42];
    const kept = raw.filter(isHookEvent);
    expect(kept).toEqual(['Turn', 'ToolCall']);
  });
});
