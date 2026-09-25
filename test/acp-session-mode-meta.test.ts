// Unit tests for ACP session-mode meta helpers — Plan/Execute Bridge P1.
//
// Pure data-shape + round-trip tests. No subprocess / no side effects.

import { describe, expect, test } from 'bun:test';
import {
  readSessionMode,
  writeSessionMode,
  sessionModeCodexDefaults,
  wrapPlanModeMessage,
  getPlanModePromptPrefix,
  SESSION_MODE_META_KEY,
} from '../src/acp/session-mode-meta.js';

describe('session mode meta · round-trip', () => {
  test('writeSessionMode produces the canonical key', () => {
    const meta = writeSessionMode('plan');
    expect(Object.keys(meta)).toContain(SESSION_MODE_META_KEY);
  });

  test('round-trip preserves plan', () => {
    expect(readSessionMode(writeSessionMode('plan'))).toBe('plan');
  });

  test('round-trip preserves execute', () => {
    expect(readSessionMode(writeSessionMode('execute'))).toBe('execute');
  });
});

describe('session mode meta · tolerant reader', () => {
  test('readSessionMode(undefined) → null', () => {
    expect(readSessionMode(undefined)).toBeNull();
  });

  test('readSessionMode(null) → null', () => {
    expect(readSessionMode(null)).toBeNull();
  });

  test('readSessionMode({}) → null (no key)', () => {
    expect(readSessionMode({})).toBeNull();
  });

  test('readSessionMode with non-string payload → null', () => {
    expect(readSessionMode({ [SESSION_MODE_META_KEY]: 42 })).toBeNull();
    expect(readSessionMode({ [SESSION_MODE_META_KEY]: { mode: 'plan' } })).toBeNull();
  });

  test('readSessionMode with unknown string → null (forward compat)', () => {
    expect(readSessionMode({ [SESSION_MODE_META_KEY]: 'unknown' })).toBeNull();
    expect(readSessionMode({ [SESSION_MODE_META_KEY]: 'review' })).toBeNull();
    expect(readSessionMode({ [SESSION_MODE_META_KEY]: '' })).toBeNull();
  });
});

describe('sessionModeCodexDefaults · auto-mapping', () => {
  test('plan → read-only sandbox + never approval', () => {
    expect(sessionModeCodexDefaults('plan')).toEqual({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    });
  });

  test('execute → empty (no defaults forced)', () => {
    expect(sessionModeCodexDefaults('execute')).toEqual({});
  });

  test('plan defaults are immutable per call', () => {
    const a = sessionModeCodexDefaults('plan');
    const b = sessionModeCodexDefaults('plan');
    a.sandboxMode = 'workspace-write';
    expect(b.sandboxMode).toBe('read-only');
  });
});

describe('wrapPlanModeMessage · prompt-level read-only guard', () => {
  const prefix = getPlanModePromptPrefix();

  test('execute mode never wraps', () => {
    expect(wrapPlanModeMessage('hello', 'claude', 'execute')).toBe('hello');
    expect(wrapPlanModeMessage('hello', 'codex-app-server', 'execute')).toBe('hello');
    expect(wrapPlanModeMessage('hello', 'gemini', 'execute')).toBe('hello');
  });

  test('mode undefined never wraps', () => {
    expect(wrapPlanModeMessage('hello', 'claude', undefined)).toBe('hello');
  });

  test('sprint 5B · plan prepends prefix on every brand uniformly', () => {
    // Pre sprint 5B the codex-native brand short-circuited the wrap
    // because the SDK sandbox enforced read-only via sandboxMode.
    // codex-app-server uses turn-level collaborationMode (M1) so the
    // prompt-prefix wrapper now applies uniformly.
    expect(wrapPlanModeMessage('hello', 'codex-app-server', 'plan')).toBe(prefix + 'hello');
    expect(wrapPlanModeMessage('hello', 'claude', 'plan')).toBe(prefix + 'hello');
    expect(wrapPlanModeMessage('hello', 'gemini', 'plan')).toBe(prefix + 'hello');
  });

  test('idempotent — no double-wrap', () => {
    const wrapped = wrapPlanModeMessage('hello', 'claude', 'plan');
    expect(wrapPlanModeMessage(wrapped, 'claude', 'plan')).toBe(wrapped);
  });

  test('prefix mentions read-only intent', () => {
    expect(prefix.toLowerCase()).toContain('read-only');
    expect(prefix.toLowerCase()).toContain('plan');
  });
});
