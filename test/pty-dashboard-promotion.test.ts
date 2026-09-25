// Native-tool catalog host contract for PtyShell tools.
// The actual dashboard wiring sits inside dashboard.ts and is
// covered by integration smoke at runtime. Here we lock the catalog
// host assignment so a future edit that reverts to host:['skill'] fails
// loudly.

import { describe, expect, test } from 'bun:test';

import {
  listNativeToolsForHost,
  buildNativeToolPromptSummary,
} from '../src/native-tool-catalog.js';

const PTY_ALIASES = ['PtyShellStart', 'PtyShellPoll', 'PtyShellSend', 'PtyShellKill'];

describe('PtyShell* catalog host', () => {
  test('each PtyShell tool shows up on skill host', () => {
    const ids = listNativeToolsForHost('skill').map(e => e.displayName);
    for (const name of PTY_ALIASES) expect(ids).toContain(name);
  });

  test('each PtyShell tool shows up on tui host', () => {
    const ids = listNativeToolsForHost('tui').map(e => e.displayName);
    for (const name of PTY_ALIASES) expect(ids).toContain(name);
  });

  test('each PtyShell tool preserves the same skill and tui host membership', () => {
    const skillIds = listNativeToolsForHost('skill').map(e => e.displayName);
    const tuiIds = listNativeToolsForHost('tui').map(e => e.displayName);
    for (const name of PTY_ALIASES) {
      expect(skillIds).toContain(name);
      expect(tuiIds).toContain(name);
    }
  });

  test('PtyShellStart description warns about tui scope gate', () => {
    const entries = listNativeToolsForHost('tui');
    const start = entries.find(e => e.displayName === 'PtyShellStart');
    expect(start).toBeDefined();
    expect(start!.description).toContain('allowDashboardPty');
  });

  test('tui prompt summary includes PtyShellStart', () => {
    const summary = buildNativeToolPromptSummary('tui');
    expect(summary).toContain('PtyShellStart');
  });
});
