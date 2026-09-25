// ── Sandbox failure escalation (AU6) ──

import { describe, test, expect } from 'bun:test';
import {
  detectSandboxFailure,
  getSandboxEscalationPrompt,
  buildSandboxEscalationSystemMessages,
} from '../../src/shell-primitive/index.js';

describe('getSandboxEscalationPrompt', () => {
  test('mentions sandboxFailure flag + AskUserQuestion + retry strategies', () => {
    const p = getSandboxEscalationPrompt();
    expect(p).toContain('sandboxFailure');
    expect(p).toContain('AskUserQuestion');
    expect(p).toContain("sandbox:'off'");
    expect(p).toContain('Do NOT loop');
  });
});

describe('buildSandboxEscalationSystemMessages', () => {
  test('returns exactly one system message every call', () => {
    const msgs = buildSandboxEscalationSystemMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content.length).toBeGreaterThan(100);
  });
});

describe('detectSandboxFailure', () => {
  test('clean success → false', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 0, stderr: '',
    })).toBe(false);
  });

  test('sandboxed=false → false (can\'t be a sandbox denial)', () => {
    expect(detectSandboxFailure({
      sandboxed: false, exitCode: 1, stderr: 'Permission denied /etc/shadow',
    })).toBe(false);
  });

  test('macOS operation-not-permitted in stderr', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 1, stderr: 'touch: /etc/foo: Operation not permitted',
    })).toBe(true);
  });

  test('sandbox-exec deny pattern', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 2, stderr: 'deny file-write /private/etc/hosts',
    })).toBe(true);
  });

  test('bwrap denial', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 1, stderr: 'bwrap: Permission denied for /run',
    })).toBe(true);
  });

  test('EACCES on protected path', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 13, stderr: 'write EACCES /proc/1/status',
    })).toBe(true);
  });

  test('permission denied outside sandbox-typical paths → false', () => {
    // user-project permission issue, not a sandbox one
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 1, stderr: 'Permission denied /tmp/myfile',
    })).toBe(false);
  });

  test('empty stderr → false (even with non-zero exit)', () => {
    expect(detectSandboxFailure({
      sandboxed: true, exitCode: 1, stderr: '',
    })).toBe(false);
  });
});
