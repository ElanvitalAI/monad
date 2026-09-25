// ── PFC-S4 follow-up: /research slash executor + argv parser ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeResearchSlash,
  parseResearchArgs,
} from '../src/auto-research/slash-execute';
import {
  ALL_AUTO_RESEARCH_RUNTIMES,
} from '../src/tool-runtime/auto-research-runtimes';
import {
  registerToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';
import { resetAutoModeForTest } from '../src/auto-research/auto-mode';

function setupRuntimes() {
  _resetToolRuntimeRegistryForTest();
  resetAutoModeForTest();
  for (const rt of ALL_AUTO_RESEARCH_RUNTIMES) registerToolRuntime(rt);
}

function makeVault() {
  const home = mkdtempSync(join(tmpdir(), 'rsh-exec-'));
  return { home, vaultEnv: join(home, 'vault') };
}

describe('PFC-S4 follow-up — parseResearchArgs', () => {
  test('parses action + positional slug', () => {
    const r = parseResearchArgs({ tokens: ['status', 'samsung-2026'] });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.action).toBe('status');
    expect(r.goal_slug).toBe('samsung-2026');
  });

  test('parses --flag value pairs', () => {
    const r = parseResearchArgs({
      tokens: ['start', 'g1', '--mission', 'My mission', '--max_turns', '5'],
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.mission).toBe('My mission');
    expect(r.max_turns).toBe(5);
  });

  test('parses --flag=value inline form', () => {
    const r = parseResearchArgs({
      tokens: ['start', 'g1', '--mission=inline'],
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.mission).toBe('inline');
  });

  test('parses --budget as JSON', () => {
    const r = parseResearchArgs({
      tokens: ['start', 'g1', '--mission', 'm', '--budget', '{"usd":3}'],
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.budget?.usd).toBe(3);
  });

  test('invalid --budget JSON returns error', () => {
    const r = parseResearchArgs({
      tokens: ['start', 'g1', '--budget', '{bad}'],
    });
    expect('error' in r).toBe(true);
  });

  test('missing action returns error', () => {
    const r = parseResearchArgs({ tokens: [] });
    expect('error' in r).toBe(true);
  });

  test('unknown action returns error', () => {
    const r = parseResearchArgs({ tokens: ['floof'] });
    expect('error' in r).toBe(true);
  });

  test('stop without slug is allowed', () => {
    const r = parseResearchArgs({ tokens: ['stop', '--summary', 'final'] });
    if ('error' in r) throw new Error(r.error);
    expect(r.action).toBe('stop');
    expect(r.summary).toBe('final');
    expect(r.goal_slug).toBeUndefined();
  });

  test('reason flag validated', () => {
    const r = parseResearchArgs({ tokens: ['stop', '--reason', 'termination_met'] });
    if ('error' in r) throw new Error(r.error);
    expect(r.reason).toBe('termination_met');
    const bad = parseResearchArgs({ tokens: ['stop', '--reason', 'bogus'] });
    if ('error' in bad) throw new Error(bad.error);
    expect(bad.reason).toBeUndefined();    // silently dropped
  });
});

describe('PFC-S4 follow-up — executeResearchSlash', () => {
  beforeEach(() => { setupRuntimes(); });

  test('start chain succeeds + summarises research_plan', async () => {
    const { home, vaultEnv } = makeVault();
    process.env.MONAD_OBSIDIAN_VAULT = vaultEnv;
    try {
      const res = await executeResearchSlash(
        {
          action: 'start',
          goal_slug: 'exec-goal',
          mission: 'Test mission',
          budget: { tokens: 1000, usd: 1 },
        },
        (name, input) => dispatchToolByName(name, input, { surface: 'dashboard' }),
      );
      expect(res.success).toBe(true);
      // Expect 1 message line + 3 dispatch summary lines
      expect(res.lines.length).toBe(4);
      expect(res.lines[0]).toContain('/research start');
      expect(res.lines.some(l => l.includes('research_plan'))).toBe(true);
    } finally {
      delete process.env.MONAD_OBSIDIAN_VAULT;
    }
  });

  test('tail dispatches research_plan read + produces lines', async () => {
    const { vaultEnv } = makeVault();
    process.env.MONAD_OBSIDIAN_VAULT = vaultEnv;
    try {
      // init first
      await executeResearchSlash(
        { action: 'start', goal_slug: 'tail-goal', mission: 'm' },
        (name, input) => dispatchToolByName(name, input, { surface: 'dashboard' }),
      );
      // now tail
      const res = await executeResearchSlash(
        { action: 'tail', goal_slug: 'tail-goal' },
        (name, input) => dispatchToolByName(name, input, { surface: 'dashboard' }),
      );
      expect(res.success).toBe(true);
      expect(res.lines.some(l => l.includes('mission'))).toBe(true);
    } finally {
      delete process.env.MONAD_OBSIDIAN_VAULT;
    }
  });

  test('error outcome from resolver returns lines without dispatch', async () => {
    let called = 0;
    const res = await executeResearchSlash(
      { action: 'start' },  // missing mission/slug
      async () => { called++; return {}; },
    );
    expect(res.success).toBe(false);
    expect(called).toBe(0);
    expect(res.lines[0]).toContain('goal_slug is required');
  });

  test('dispatch throw propagates as failure line', async () => {
    const res = await executeResearchSlash(
      { action: 'tail', goal_slug: 'missing' },
      async (name) => { throw new Error(`boom-${name}`); },
    );
    expect(res.success).toBe(false);
    expect(res.lines.some(l => l.includes('boom-research_plan'))).toBe(true);
  });
});
