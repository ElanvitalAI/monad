// H6 P4 · AgentRoomSpec / type guards / validation.

import { describe, test, expect } from 'bun:test';
import {
  presetArityFor,
  presetForArity,
  isAgentRoomPresetName,
  isAgentRoomRoleHint,
  validateAgentRoomSpec,
  DEFAULT_ROLE_HINT_BY_INDEX,
  type AgentRoomSpec,
} from '../src/agent-room/types.js';

describe('preset arity helpers', () => {
  test('presetArityFor maps every preset to a fixed count', () => {
    expect(presetArityFor('two-split')).toBe(2);
    expect(presetArityFor('three-split')).toBe(3);
    expect(presetArityFor('four-quad')).toBe(4);
  });

  test('presetForArity inverse · arity 2/3/4', () => {
    expect(presetForArity(2)).toBe('two-split');
    expect(presetForArity(3)).toBe('three-split');
    expect(presetForArity(4)).toBe('four-quad');
  });

  test('presetForArity throws with clear message for out-of-range N', () => {
    expect(() => presetForArity(1)).toThrow(/2\/3\/4/);
    expect(() => presetForArity(5)).toThrow(/2\/3\/4/);
  });
});

describe('type guards', () => {
  test('isAgentRoomPresetName accepts known · rejects unknown', () => {
    expect(isAgentRoomPresetName('two-split')).toBe(true);
    expect(isAgentRoomPresetName('five-split')).toBe(false);
    expect(isAgentRoomPresetName(null)).toBe(false);
  });

  test('isAgentRoomRoleHint accepts canonical 4 · rejects typos', () => {
    expect(isAgentRoomRoleHint('plan')).toBe(true);
    expect(isAgentRoomRoleHint('reflect')).toBe(true);
    expect(isAgentRoomRoleHint('planner')).toBe(false);
    expect(isAgentRoomRoleHint(undefined)).toBe(false);
  });
});

describe('validateAgentRoomSpec', () => {
  const makeSpec = (overrides: Partial<AgentRoomSpec> = {}): AgentRoomSpec => ({
    preset: 'three-split',
    members: [
      { brandRef: 'codex' },
      { brandRef: 'claude' },
      { brandRef: 'gemini' },
    ],
    layoutMode: 'single-vw',
    ...overrides,
  });

  test('happy path · valid 3-split', () => {
    expect(() => validateAgentRoomSpec(makeSpec())).not.toThrow();
  });

  test('rejects arity mismatch · clear message', () => {
    expect(() =>
      validateAgentRoomSpec(makeSpec({ members: [{ brandRef: 'codex' }] })),
    ).toThrow(/expects 3 members/);
  });

  test('rejects focusIndex out of range', () => {
    expect(() => validateAgentRoomSpec(makeSpec({ focusIndex: 5 }))).toThrow(/out of range/);
    expect(() => validateAgentRoomSpec(makeSpec({ focusIndex: -1 }))).toThrow(/out of range/);
  });

  test('rejects multi-vw layoutMode · Bundle 2 message', () => {
    // multi-vw is Bundle 2 · schema accepts the string but validator rejects
    // so callers get a clear upgrade prompt instead of a silent fallback.
    expect(() =>
      validateAgentRoomSpec(makeSpec({ layoutMode: 'multi-vw' })),
    ).toThrow(/Bundle 2/);
  });

  test('rejects empty brandRef', () => {
    expect(() =>
      validateAgentRoomSpec(
        makeSpec({
          members: [{ brandRef: '' }, { brandRef: 'claude' }, { brandRef: 'gemini' }],
        }),
      ),
    ).toThrow(/brandRef/);
  });
});

describe('DEFAULT_ROLE_HINT_BY_INDEX', () => {
  test('matches slash convention · plan / exec / review / reflect', () => {
    expect(DEFAULT_ROLE_HINT_BY_INDEX).toEqual(['plan', 'exec', 'review', 'reflect']);
  });
});
