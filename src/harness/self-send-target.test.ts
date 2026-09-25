import { describe, expect, test } from 'bun:test';
import { resolveSelfSendTarget, type SelfSendTargetDeps } from './self-send-target.js';

function deps(overrides: Partial<SelfSendTargetDeps> = {}): SelfSendTargetDeps {
  return {
    getPtyManifest: () => null,
    listPtyManifestRows: () => [],
    ...overrides,
  };
}

describe('resolveSelfSendTarget', () => {
  test('refuses a TUI self-report with no manifest hint', () => {
    expect(resolveSelfSendTarget('tui:84650', deps())).toEqual({
      kind: 'refuse',
      reason: 'tui-self-report-has-no-inbox-reader',
    });
  });

  test('refuses a TUI self-report with its PID-matched space hint', () => {
    expect(resolveSelfSendTarget('tui:84650', deps({
      listPtyManifestRows: () => [{ id: 'pty_a', spaceId: 'dev-run-x', ptyPid: 84650 }],
    }))).toEqual({
      kind: 'refuse',
      reason: 'tui-self-report-has-no-inbox-reader',
      hint: 'dev-run-x',
    });
  });

  test('resolves a PTY id through its manifest space', () => {
    expect(resolveSelfSendTarget('pty_a', deps({
      getPtyManifest: () => ({ spaceId: 'dev-run-x' }),
    }))).toEqual({
      kind: 'space',
      spaceId: 'dev-run-x',
      via: 'pty',
      ptyId: 'pty_a',
    });
  });

  test('refuses a PTY manifest without a space', () => {
    expect(resolveSelfSendTarget('pty_b', deps({
      getPtyManifest: () => ({ spaceId: '' }),
    }))).toEqual({ kind: 'refuse', reason: 'pty-has-no-space' });
  });

  test('passes through an ordinary space without calling dependencies', () => {
    let calls = 0;
    expect(resolveSelfSendTarget('dev-run-x', deps({
      getPtyManifest: () => { calls += 1; return null; },
      listPtyManifestRows: () => { calls += 1; return []; },
    }))).toEqual({ kind: 'space', spaceId: 'dev-run-x' });
    expect(calls).toBe(0);
  });
});
