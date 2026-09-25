// A — a brain-initiated `delegate_code_agent` joins the continuous coding
// session: it arms active delegation so plain NL follow-ups continue that
// backend (via runAcpViaSlash + carry-in) instead of re-delegating a fresh
// ephemeral session each turn.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { delegateBackendToSlashKey } from '../src/telegram-agent';

describe('delegateBackendToSlashKey', () => {
  test('maps delegate backends to the slash-continue key', () => {
    expect(delegateBackendToSlashKey('claude')).toBe('claude');
    expect(delegateBackendToSlashKey('codex-app-server')).toBe('codex');
    expect(delegateBackendToSlashKey('codex')).toBe('codex');
    expect(delegateBackendToSlashKey('gemini')).toBe('gemini');
  });
  test('null for backends with no slash-continue path', () => {
    expect(delegateBackendToSlashKey('grok')).toBeNull();
    expect(delegateBackendToSlashKey('mystery')).toBeNull();
  });
});

// Source guard — the arm must fire after a SUCCESSFUL delegate, skip on
// failure / unmapped backend, and use the chat identity. Behavioral drive
// would spawn a real ACP backend, so assert the wire at the source.
//
// The delegate assembly moved out of telegram-agent.ts (M4a, 2026-07-12):
// failure derivation now lives in the surface-agnostic dispatcher
// (autonomous-tools.ts) which hands (backend, failed) to the surface's
// onDelegated callback; the chat-scoped arming lives in monad-agent-turn.ts.
describe('delegate arm wire (source guard)', () => {
  const dispatchSrc = readFileSync(join(import.meta.dir, '..', 'src/agent/autonomous-tools.ts'), 'utf-8');
  const turnSrc = readFileSync(join(import.meta.dir, '..', 'src/agent/monad-agent-turn.ts'), 'utf-8');
  test('arms active delegation after a non-failed, mapped, chat-scoped delegate', () => {
    expect(dispatchSrc).toMatch(/const failed = !!\(result && typeof result === 'object' && 'error' in result\)/);
    expect(turnSrc).toMatch(/if \(!failed && slashKey && opts\.tgChat\)/);
    expect(turnSrc).toContain('setActiveDelegation(delegationChatKey(opts.tgChat.botId');
  });
});
