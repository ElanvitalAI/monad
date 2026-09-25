import { describe, expect, test } from 'bun:test';

import {
  createDashboardChordActionRunner,
  matchDashboardChordAction,
} from '../src/dashboard/input/dashboard-chord-actions.js';
import type { Key } from '../src/tui.js';

function key(name: string, mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...mods };
}

describe('matchDashboardChordAction', () => {
  test('matches the extracted ctrl+b chord bodies', () => {
    expect(matchDashboardChordAction(key('w', { ctrl: true }))).toEqual({ kind: 'focus-browser' });
    expect(matchDashboardChordAction(key('o', { ctrl: true }))).toEqual({ kind: 'focus-obsidian' });
    expect(matchDashboardChordAction(key('s', { ctrl: true }))).toEqual({ kind: 'reopen-scratch' });
    expect(matchDashboardChordAction(key('b'))).toEqual({ kind: 'toggle-bell' });
    expect(matchDashboardChordAction(key('S'))).toEqual({ kind: 'focus-sessions' });
    expect(matchDashboardChordAction(key('n'))).toEqual({ kind: 'cycle-sessions', delta: 1 });
    expect(matchDashboardChordAction(key('p'))).toEqual({ kind: 'cycle-sessions', delta: -1 });
    expect(matchDashboardChordAction(key('x'))).toEqual({ kind: 'close-pane' });
    expect(matchDashboardChordAction(key('o'))).toEqual({ kind: 'reopen-panes' });
    expect(matchDashboardChordAction(key('m'))).toEqual({ kind: 'open-pane-modal' });
    expect(matchDashboardChordAction(key('z'))).toEqual({ kind: 'toggle-log-zoom' });
    expect(matchDashboardChordAction(key('t'))).toEqual({ kind: 'open-preview-terminal' });
    expect(matchDashboardChordAction(key('e'))).toEqual({ kind: 'toggle-preview-terminal-expand' });
  });

  test('returns null for unrelated keys or ctrl+b re-arm', () => {
    expect(matchDashboardChordAction(key('b', { ctrl: true }))).toBeNull();
    expect(matchDashboardChordAction(key('q'))).toBeNull();
  });
});

describe('createDashboardChordActionRunner', () => {
  test('routes extracted chord actions through the corresponding deps', async () => {
    const calls: string[] = [];
    const run = createDashboardChordActionRunner({
      focusBrowser: () => { calls.push('browser'); },
      focusObsidian: () => { calls.push('obsidian'); },
      reopenScratch: () => { calls.push('scratch'); },
      toggleBell: () => { calls.push('bell'); },
      focusSessions: () => { calls.push('sessions'); },
      cycleSessions: (delta) => { calls.push(`cycle:${delta}`); },
      closePane: () => { calls.push('close'); return true; },
      reopenPanes: () => { calls.push('reopen'); },
      openPaneModal: () => { calls.push('modal'); },
      toggleLogZoom: () => { calls.push('zoom'); },
      openPreviewTerminal: () => { calls.push('preview-open'); },
      togglePreviewTerminalExpand: () => { calls.push('preview-expand'); },
    });

    await run({ kind: 'focus-browser' });
    await run({ kind: 'focus-obsidian' });
    await run({ kind: 'reopen-scratch' });
    await run({ kind: 'toggle-bell' });
    await run({ kind: 'focus-sessions' });
    await run({ kind: 'cycle-sessions', delta: 1 });
    await run({ kind: 'close-pane' });
    await run({ kind: 'reopen-panes' });
    await run({ kind: 'open-pane-modal' });
    await run({ kind: 'toggle-log-zoom' });
    await run({ kind: 'open-preview-terminal' });
    await run({ kind: 'toggle-preview-terminal-expand' });

    expect(calls).toEqual([
      'browser',
      'obsidian',
      'scratch',
      'bell',
      'sessions',
      'cycle:1',
      'close',
      'reopen',
      'modal',
      'zoom',
      'preview-open',
      'preview-expand',
    ]);
  });
});
