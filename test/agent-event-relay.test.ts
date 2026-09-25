// Phase 1 · Channel Terminal Relay — pure formatter tests.
//
// 내부 문서 `PLAN-channel-terminal-relay-2026-07-09` §A. Pins the contract
// that ACP tool_call / tool_call_update content (command · stdout ·
// diff) reaches the chat instead of being stripped to a bare marker.

import { describe, expect, test } from 'bun:test';
import {
  renderToolUpdate,
  extractToolCommand,
  extractToolText,
  isMutatingTool,
  type RelayToolUpdate,
} from '../src/channel/agent-event-relay';

describe('extractToolCommand', () => {
  test('string command (claude Bash / codex exec)', () => {
    expect(extractToolCommand({ command: 'npm test' })).toBe('npm test');
  });
  test('argv array command', () => {
    expect(extractToolCommand({ command: ['git', 'status', '-s'] })).toBe('git status -s');
  });
  test('no command (file edit) → undefined', () => {
    expect(extractToolCommand({ changes: [{ path: 'a.ts' }] })).toBeUndefined();
    expect(extractToolCommand(null)).toBeUndefined();
    expect(extractToolCommand('nope')).toBeUndefined();
  });
});

describe('extractToolText', () => {
  test('probes common output fields', () => {
    expect(extractToolText({ stdout: 'ok\n' })).toBe('ok');
    expect(extractToolText({ output: 'built' })).toBe('built');
    expect(extractToolText({ error: 'boom' })).toBe('boom');
  });
  test('plain string', () => {
    expect(extractToolText('  hello  ')).toBe('hello');
  });
  test('empty / nullish → undefined', () => {
    expect(extractToolText(undefined)).toBeUndefined();
    expect(extractToolText(null)).toBeUndefined();
    expect(extractToolText('   ')).toBeUndefined();
  });
  test('falls back to JSON for unknown object shape', () => {
    expect(extractToolText({ weird: 1 })).toBe('{"weird":1}');
  });
});

describe('isMutatingTool', () => {
  test('kind-based classification', () => {
    expect(isMutatingTool('execute', undefined)).toBe(true);
    expect(isMutatingTool('edit', undefined)).toBe(true);
    expect(isMutatingTool('read', undefined)).toBe(false);
    expect(isMutatingTool('search', undefined)).toBe(false);
  });
  test('title heuristic when kind absent', () => {
    expect(isMutatingTool(undefined, 'Bash')).toBe(true);
    expect(isMutatingTool(undefined, 'Grep')).toBe(false);
  });
  test('unknown → mutating (never silently hide an action)', () => {
    expect(isMutatingTool(undefined, 'MysteryTool')).toBe(true);
  });
});

describe('renderToolUpdate · tool_call (command in)', () => {
  test('mutating tool shows fenced command', () => {
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call',
      title: 'Bash',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm test' },
    };
    const r = renderToolUpdate(u);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Bash');
    expect(r!.text).toContain('```bash');
    expect(r!.text).toContain('npm test');
  });

  test('read-only tool at normal → compact 1-line header, no body', () => {
    const u: RelayToolUpdate = { sessionUpdate: 'tool_call', title: 'Read', kind: 'read' };
    const r = renderToolUpdate(u, { verbosity: 'normal' });
    expect(r).not.toBeNull();
    expect(r!.text).toContain('Read');
    expect(r!.text).not.toContain('```');
  });

  test('quiet hides read-only tool entirely', () => {
    const u: RelayToolUpdate = { sessionUpdate: 'tool_call', title: 'Grep', kind: 'search' };
    expect(renderToolUpdate(u, { verbosity: 'quiet' })).toBeNull();
  });
});

describe('renderToolUpdate · tool_call_update (output out)', () => {
  test('shell output fenced', () => {
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawOutput: { stdout: 'PASS 12 tests' },
    };
    const r = renderToolUpdate(u);
    expect(r!.text).toContain('PASS 12 tests');
    expect(r!.overflow).toBeUndefined();
  });

  test('diff output fenced as diff', () => {
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new';
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      rawOutput: diff,
    };
    const r = renderToolUpdate(u);
    expect(r!.text).toContain('```diff');
  });

  test('failure surfaces even with no output', () => {
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Bash',
      kind: 'execute',
      status: 'failed',
    };
    const r = renderToolUpdate(u);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('failed');
  });

  test('long output truncates inline + signals overflow with full body', () => {
    const big = 'x'.repeat(5000);
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawOutput: big,
    };
    const r = renderToolUpdate(u, { maxInline: 1000 });
    expect(r!.text).toContain('truncated');
    expect(r!.overflow).toBeDefined();
    expect(r!.overflow!.body.length).toBe(5000);
    expect(r!.overflow!.ext).toBe('txt');
  });

  test('read-only tool output is suppressed at normal (noise) unless failed', () => {
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      rawOutput: { content: 'file contents ...' },
    };
    expect(renderToolUpdate(u, { verbosity: 'normal' })).toBeNull();
    expect(renderToolUpdate(u, { verbosity: 'verbose' })).not.toBeNull();
  });
});

describe('renderToolUpdate · fence safety', () => {
  test('output containing a closing fence is neutralized', () => {
    const u: RelayToolUpdate = {
      sessionUpdate: 'tool_call_update',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawOutput: 'echo ```markdown```',
    };
    const r = renderToolUpdate(u);
    // The raw triple-backtick must not appear verbatim (would break the fence).
    expect(r!.text.includes('```markdown```')).toBe(false);
  });
});

describe('renderToolUpdate · non tool updates → null', () => {
  test('agent_message_chunk ignored (handled elsewhere)', () => {
    expect(renderToolUpdate({ sessionUpdate: 'agent_message_chunk' })).toBeNull();
  });
});
