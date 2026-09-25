import { describe, expect, test } from 'bun:test';

import { AGENT_KIND_OVERRIDE_FLAG, detectAgentFromSpec, detectAgentKind } from '../src/agent-detect.js';

describe('agent-detect', () => {
  test('UA1 — direct basename: claude / claude-code → claude-code', () => {
    expect(detectAgentKind('claude').agentKind).toBe('claude-code');
    expect(detectAgentKind('claude-code').agentKind).toBe('claude-code');
    expect(detectAgentKind('/usr/local/bin/claude', []).agentKind).toBe('claude-code');
    expect(detectAgentKind('claude').character).toEqual({ kind: 'claude-code' });
  });

  test('UA1 — wrapper: bunx @anthropic-ai/claude-code', () => {
    const r = detectAgentKind('bunx', ['@anthropic-ai/claude-code', '--some-flag']);
    expect(r.agentKind).toBe('claude-code');
    expect(r.overridden).toBe(false);
  });

  test('UA1 — wrapper: npx @google/gemini-cli → gemini-cli', () => {
    expect(detectAgentKind('npx', ['@google/gemini-cli']).agentKind).toBe('gemini-cli');
    expect(detectAgentKind('gemini').agentKind).toBe('gemini-cli');
    expect(detectAgentKind('gemini-cli').agentKind).toBe('gemini-cli');
  });

  test('UA1 — direct: codex → codex, aider → aider', () => {
    expect(detectAgentKind('codex').agentKind).toBe('codex');
    expect(detectAgentKind('bunx', ['@openai/codex']).agentKind).toBe('codex');
    expect(detectAgentKind('aider').agentKind).toBe('aider');
  });

  test('UA1 — node-wrapped script: node /tmp/claude.js', () => {
    expect(detectAgentKind('node', ['/tmp/claude.js']).agentKind).toBe('claude-code');
    expect(detectAgentKind('node', ['/opt/agents/aider.mjs']).agentKind).toBe('aider');
  });

  test('UA1 — fallback to shell for unknown cmds', () => {
    expect(detectAgentKind('bash').agentKind).toBe('shell');
    expect(detectAgentKind('zsh', ['-l']).agentKind).toBe('shell');
    expect(detectAgentKind('/bin/sh').agentKind).toBe('shell');
    expect(detectAgentKind('', []).agentKind).toBe('shell');
  });

  test('UA1 — override flag wins over direct cmd', () => {
    const r = detectAgentKind('claude', [`${AGENT_KIND_OVERRIDE_FLAG}shell`]);
    expect(r.agentKind).toBe('shell');
    expect(r.overridden).toBe(true);
    expect(r.character).toEqual({ kind: 'shell' });
  });

  test('UA1 — override rejects unknown kinds and falls through', () => {
    const r = detectAgentKind('bash', [`${AGENT_KIND_OVERRIDE_FLAG}imaginary`]);
    expect(r.agentKind).toBe('shell');
    expect(r.overridden).toBe(false);
  });

  test('UA1 — wrapper skips flags before positional', () => {
    const r = detectAgentKind('bunx', ['--yes', '-q', '@anthropic-ai/claude-code']);
    expect(r.agentKind).toBe('claude-code');
  });

  test('UA1 — character is custom for gemini-cli / aider, native for claude/codex/shell', () => {
    expect(detectAgentKind('gemini').character).toEqual({ kind: 'custom', name: 'gemini-cli' });
    expect(detectAgentKind('aider').character).toEqual({ kind: 'custom', name: 'aider' });
    expect(detectAgentKind('codex').character).toEqual({ kind: 'codex' });
    expect(detectAgentKind('bash').character).toEqual({ kind: 'shell' });
  });

  // ── UA2 support — detectAgentFromSpec ─────────────────────────

  test('UA2 — detectAgentFromSpec: explicit character wins over command', () => {
    const r = detectAgentFromSpec({ character: { kind: 'claude-code' }, command: 'bash' });
    expect(r.agentKind).toBe('claude-code');
    expect(r.character).toEqual({ kind: 'claude-code' });
  });

  test('UA2 — detectAgentFromSpec: parses spec.command when character is shell', () => {
    const r = detectAgentFromSpec({ character: { kind: 'shell' }, command: 'claude --resume' });
    expect(r.agentKind).toBe('claude-code');
    expect(r.character).toEqual({ kind: 'claude-code' });
  });

  test('UA2 — detectAgentFromSpec: custom.name that is a valid AgentKind flows through', () => {
    const r = detectAgentFromSpec({ character: { kind: 'custom', name: 'aider' } });
    expect(r.agentKind).toBe('aider');
    expect(r.character).toEqual({ kind: 'custom', name: 'aider' });
  });

  test('UA2 — detectAgentFromSpec: no character, no command → shell', () => {
    const r = detectAgentFromSpec({});
    expect(r.agentKind).toBe('shell');
    expect(r.character).toEqual({ kind: 'shell' });
  });
});
