// Slash-registration + LLM-allowlist tests for the VW coding-agent
// spawners. The actual dispatch lives in dashboard.ts's interactive
// switch (hard to drive headless) — we pin the visible surface:
//
//   • SLASH_COMMANDS entries for claude-vw / codex-vw / acp-vw
//   • ALLOWED_SLASHES whitelisting for LLM control mode
//   • /acp description no longer claims to spawn in a VW (stale)
//
// Ref: 내부 문서 `MANUAL-virtual-window` §2.

import { describe, expect, test } from 'bun:test';
import { SLASH_COMMANDS } from '../src/chat/index.js';
import { ALLOWED_SLASHES } from '../src/skills/tools/dashboard-slash.js';

describe('VW spawn slash aliases', () => {
  test('SLASH_COMMANDS registers /claude-vw', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'claude-vw');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toMatch(/virtual window/i);
  });

  test('SLASH_COMMANDS registers /codex-vw', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'codex-vw');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toMatch(/virtual window/i);
  });

  test('SLASH_COMMANDS registers /acp-vw with claude/codex subcommands', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'acp-vw');
    expect(cmd).toBeDefined();
    expect(cmd!.subcommands).toContain('claude');
    expect(cmd!.subcommands).toContain('codex');
  });

  test('/acp description reflects chat-mode, not VW-spawn (stale fix)', () => {
    const cmd = SLASH_COMMANDS.find(c => c.name === 'acp');
    expect(cmd).toBeDefined();
    // Chat, not "inside a virtual window" (that was /acp-vw).
    expect(cmd!.description).toMatch(/chat/i);
    expect(cmd!.description).not.toMatch(/inside a virtual window/i);
  });

  test('LLM ALLOWED_SLASHES includes the VW spawners', () => {
    expect(ALLOWED_SLASHES).toContain('claude-vw');
    expect(ALLOWED_SLASHES).toContain('codex-vw');
    expect(ALLOWED_SLASHES).toContain('acp-vw');
  });
});
