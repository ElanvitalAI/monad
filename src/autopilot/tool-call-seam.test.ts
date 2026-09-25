// src/autopilot/tool-call-seam.test.ts
//
// ROADMAP-monad-builtin §MB-4 — tool_call intercept seam 공용화 검증.
//
// `AutopilotLoopDriver` 의 onUpdate 안 tool_call 처리 (risky pattern
// scan · terminal-forwarder shell extraction · screenshot reflection)
// 는 ACP backend 와 monad-builtin path 가 동일 SessionUpdate shape 를
// emit 한다는 전제 위에서 동작. 본 test 는 그 contract 를 pin —
// MonadBuiltinTurnRunner 가 emit 하는 SessionUpdate shape 이
// extractShellCommand · scanRiskyToolCall 양쪽과 1:1 호환임을 명시.

import { describe, test, expect } from 'bun:test';
import { extractShellCommand } from './agent-loop.js';
import { scanRiskyToolCall } from './risky-pattern.js';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

/**
 * 같은 shape 을 `MonadBuiltinTurnRunner.prompt` 의 `onToolCall` adapter
 * 가 emit — keys 모두 `monad-builtin-runner.ts` 의 `onToolCall` callback
 * 과 일치해야 한다.
 */
function buildMonadBuiltinToolCall(opts: {
  id: string;
  name: string;
  args: Record<string, unknown>;
}): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: opts.id,
    toolName: opts.name,
    title: opts.name,
    status: 'in_progress',
    rawInput: opts.args,
  } as unknown as SessionUpdate;
}

describe('tool_call seam — MonadBuiltinTurnRunner emission contract', () => {
  test('Bash tool_call → extractShellCommand returns the command', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-1',
      name: 'Bash',
      args: { command: 'ls -la /tmp' },
    });
    expect(extractShellCommand(update)).toBe('ls -la /tmp');
  });

  test('Non-shell tool_call → extractShellCommand returns null', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-2',
      name: 'Read',
      args: { file_path: '/etc/passwd' },
    });
    expect(extractShellCommand(update)).toBeNull();
  });

  test('Bash tool_call with rm -rf → scanRiskyToolCall flags rm-rf · high', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-3',
      name: 'Bash',
      args: { command: 'rm -rf /tmp/x' },
    });
    const pattern = scanRiskyToolCall(update);
    expect(pattern).not.toBeNull();
    expect(pattern?.kind).toBe('rm-rf');
    expect(pattern?.severity).toBe('high');
  });

  test('Bash tool_call with sudo → scanRiskyToolCall flags sudo · high', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-4',
      name: 'Bash',
      args: { command: 'sudo systemctl restart foo' },
    });
    const pattern = scanRiskyToolCall(update);
    expect(pattern?.kind).toBe('sudo');
    expect(pattern?.severity).toBe('high');
  });

  test('Bash tool_call with git push --force → flags force-push · high', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-5',
      name: 'Bash',
      args: { command: 'git push --force origin main' },
    });
    const pattern = scanRiskyToolCall(update);
    expect(pattern?.kind).toBe('force-push');
    expect(pattern?.severity).toBe('high');
  });

  test('Bash tool_call with git reset --hard → flags reset-hard · medium', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-6',
      name: 'Bash',
      args: { command: 'git reset --hard HEAD~1' },
    });
    const pattern = scanRiskyToolCall(update);
    expect(pattern?.kind).toBe('reset-hard');
    expect(pattern?.severity).toBe('medium');
  });

  test('Safe Bash tool_call → no pattern flagged', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-7',
      name: 'Bash',
      args: { command: 'pwd && ls' },
    });
    expect(scanRiskyToolCall(update)).toBeNull();
  });

  test('shell tool name variants are recognized by extractShellCommand', () => {
    for (const name of ['Bash', 'shell', 'exec', 'terminal']) {
      const update = buildMonadBuiltinToolCall({
        id: 'tc-name',
        name,
        args: { command: 'echo hi' },
      });
      expect(extractShellCommand(update)).toBe('echo hi');
    }
  });
});

describe('tool_call seam — emission carries fields driver expects', () => {
  test('emission shape has sessionUpdate + toolCallId + toolName + rawInput', () => {
    const update = buildMonadBuiltinToolCall({
      id: 'tc-shape',
      name: 'Bash',
      args: { command: 'echo hi' },
    });
    const u = update as unknown as Record<string, unknown>;
    expect(u.sessionUpdate).toBe('tool_call');
    expect(u.toolCallId).toBe('tc-shape');
    expect(u.toolName).toBe('Bash');
    expect((u.rawInput as Record<string, unknown>).command).toBe('echo hi');
  });
});
