// ── Approval-policy system prompt (AU2) ──

import { describe, test, expect, afterEach } from 'bun:test';
import {
  buildApprovalPolicyPrompt,
  buildApprovalPolicySystemMessages,
  setPolicy,
  resetPolicyToDefault,
} from '../../src/code-edit/index.js';

describe('buildApprovalPolicyPrompt', () => {
  test('ask-edit: describes Approve / Deny / Approve-session', () => {
    const p = buildApprovalPolicyPrompt({ mode: 'ask-edit' });
    expect(p).not.toBeNull();
    expect(p!).toContain('ASK-EDIT');
    expect(p!).toContain('Approve');
    expect(p!).toContain('Deny');
    expect(p!).toContain('Approve-session');
    expect(p!).toContain('AskUserQuestion');
  });

  test('ask-all: mentions minimize round-trips + tools beyond Edit', () => {
    const p = buildApprovalPolicyPrompt({ mode: 'ask-all' });
    expect(p).not.toBeNull();
    expect(p!).toContain('ASK-ALL');
    expect(p!).toMatch(/Minimize round-trips/i);
    expect(p!).toContain('Bash');
  });

  test('unsupervised: warns about missing gate + UndoTurn mention', () => {
    const p = buildApprovalPolicyPrompt({ mode: 'unsupervised' });
    expect(p).not.toBeNull();
    expect(p!).toContain('UNSUPERVISED');
    expect(p!).toContain('UndoTurn');
    expect(p!).toContain('AskUserQuestion BEFORE');
    expect(p!).toContain('additive');
  });

  test('trusted-dirs: substitutes TRUSTED_DIRS template', () => {
    const p = buildApprovalPolicyPrompt({
      mode: 'trusted-dirs',
      trustedDirs: ['/home/me/work', '/opt/project'],
    });
    expect(p).not.toBeNull();
    expect(p!).toContain('TRUSTED-DIRS');
    expect(p!).toContain('/home/me/work');
    expect(p!).toContain('/opt/project');
    expect(p!).not.toContain('{TRUSTED_DIRS}');
  });

  test('trusted-dirs with empty list: explicit fallback message', () => {
    const p = buildApprovalPolicyPrompt({ mode: 'trusted-dirs', trustedDirs: [] });
    expect(p!).toContain('no trusted directories configured');
  });
});

describe('buildApprovalPolicySystemMessages', () => {
  afterEach(() => resetPolicyToDefault());

  test('default (ask-edit) returns 1 system message', () => {
    resetPolicyToDefault();
    const msgs = buildApprovalPolicySystemMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('ASK-EDIT');
  });

  test('flipping policy flips the prompt on next call', () => {
    setPolicy({ mode: 'unsupervised' });
    const msgs1 = buildApprovalPolicySystemMessages();
    expect(msgs1[0]!.content).toContain('UNSUPERVISED');

    setPolicy({ mode: 'trusted-dirs', trustedDirs: ['/a'] });
    const msgs2 = buildApprovalPolicySystemMessages();
    expect(msgs2[0]!.content).toContain('TRUSTED-DIRS');
    expect(msgs2[0]!.content).toContain('/a');
  });
});
