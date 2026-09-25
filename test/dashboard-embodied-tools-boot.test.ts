import { describe, expect, test } from 'bun:test';

import { bootDashboardEmbodiedTools } from '../src/dashboard/embodied-tools-boot.js';
import type { HandoffLookup } from '../src/agent/handoff.js';
import type { SessionLookup } from '../src/skills/tools/tty-snapshot.js';

describe('bootDashboardEmbodiedTools', () => {
  test('registers adapter hooks and wires snapshot/handoff lookups', async () => {
    const hooks: Array<{ name: string; hook: unknown }> = [];
    let snapshotLookup: SessionLookup | undefined;
    let handoffLookup: HandoffLookup | undefined;
    const alphaSession = {
      id: 'sess-alpha',
      snapshot: async () => 'alpha-screen',
    };
    const betaSession = {
      id: 'sess-beta',
      snapshot: async () => 'beta-screen',
    };

    bootDashboardEmbodiedTools({
      registerDefaultPatterns: () => {},
      router: {
        registerAdapterHook: (name, hook) => { hooks.push({ name, hook }); },
      },
      codexChannelHook: () => 'codex-hook',
      claudeChannelHook: () => 'claude-hook',
      geminiChannelHook: () => 'gemini-hook',
      initTtySnapshotTools: (lookup) => { snapshotLookup = lookup; },
      initAgentHandoffTool: (lookup) => { handoffLookup = lookup; },
      findSessionById: (id) => id === 'alpha' ? { session: alphaSession } : null,
      findSessionByPaneId: (paneId) => paneId === 'pane-beta' ? { session: betaSession } : null,
    });

    expect(hooks).toEqual([
      { name: 'codex-pty', hook: 'codex-hook' },
      { name: 'claude-pty', hook: 'claude-hook' },
      { name: 'gemini-pty', hook: 'gemini-hook' },
    ]);
    expect(handoffLookup?.findSession('alpha')).toBe(alphaSession);
    const alphaLookup = snapshotLookup?.findSession('alpha');
    expect(alphaLookup?.id).toBe('sess-alpha');
    expect(await alphaLookup?.snapshot()).toBe('alpha-screen');
    const betaLookup = snapshotLookup?.findSessionByPaneId?.('pane-beta');
    expect(betaLookup?.id).toBe('sess-beta');
    expect(await betaLookup?.snapshot()).toBe('beta-screen');
  });
});
