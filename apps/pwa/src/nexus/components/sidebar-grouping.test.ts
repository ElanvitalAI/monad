// PWA · sidebar grouping logic tests (Phase N-4 PR ο)

import { describe, test, expect } from 'bun:test';
import { groupTabsForSidebar, KIND_DISPLAY_ORDER, KIND_DISPLAY_LABEL } from './sidebar-grouping';
import { STATUS_BADGE_GLYPH, STATUS_BADGE_TONE, STATUS_BADGE_LABEL } from './status-badge';
import type { NexusTabState, NexusTabKind, NexusTabStatus } from '../types';

function makeTab(id: string, kind: NexusTabKind, status: NexusTabStatus = 'idle'): NexusTabState {
  return {
    spec: { id, kind, label: id },
    status,
    restartCount: 0,
    restartCountWindowStart: 0,
  };
}

describe('groupTabsForSidebar', () => {
  test('empty list → empty array', () => {
    expect(groupTabsForSidebar([])).toEqual([]);
  });

  test('canonical kind order respected', () => {
    // Surface-unification v2.2 V2.2-6 v2 (2026-05-11) — 'scheduler' kind
    // retired. Order tail is now `channel-bot`.
    const tabs: NexusTabState[] = [
      makeTab('channel-bot:1', 'channel-bot'),
      makeTab('chat:1', 'chat'),
      makeTab('daemon:1', 'daemon'),
      makeTab('webterm:1', 'webterm'),
    ];
    const groups = groupTabsForSidebar(tabs);
    expect(groups.map((g) => g.kind)).toEqual(['chat', 'webterm', 'daemon', 'channel-bot']);
  });

  test('within-kind tabs sorted by id', () => {
    const tabs: NexusTabState[] = [
      makeTab('chat:3', 'chat'),
      makeTab('chat:1', 'chat'),
      makeTab('chat:2', 'chat'),
    ];
    const [chatGroup] = groupTabsForSidebar(tabs);
    expect(chatGroup.tabs.map((t) => t.spec.id)).toEqual(['chat:1', 'chat:2', 'chat:3']);
  });

  test('includeEmpty=false (default) hides empty kinds', () => {
    expect(groupTabsForSidebar([makeTab('chat:1', 'chat')]).map((g) => g.kind)).toEqual(['chat']);
  });

  test('includeEmpty=true emits all 6 kinds', () => {
    const groups = groupTabsForSidebar([makeTab('chat:1', 'chat')], { includeEmpty: true });
    expect(groups.map((g) => g.kind)).toEqual(KIND_DISPLAY_ORDER);
    const empty = groups.find((g) => g.kind === 'webterm')!;
    expect(empty.tabs).toEqual([]);
  });

  test('group label matches KIND_DISPLAY_LABEL', () => {
    const groups = groupTabsForSidebar([makeTab('chat:1', 'chat')]);
    expect(groups[0].label).toBe(KIND_DISPLAY_LABEL.chat);
  });
});

describe('StatusBadge mapping tables', () => {
  const allStatuses: NexusTabStatus[] = ['idle', 'starting', 'active', 'unhealthy', 'restarting', 'crashed', 'stopped', 'external'];

  test('every status has a glyph + tone + label', () => {
    for (const s of allStatuses) {
      expect(STATUS_BADGE_GLYPH[s]).toBeDefined();
      expect(STATUS_BADGE_TONE[s]).toBeDefined();
      expect(STATUS_BADGE_LABEL[s]).toBeDefined();
    }
  });

  test('active = ● + emerald · external = ⚠ + purple · crashed = ✕ + rose', () => {
    expect(STATUS_BADGE_GLYPH.active).toBe('●');
    expect(STATUS_BADGE_TONE.active).toContain('emerald');
    expect(STATUS_BADGE_GLYPH.external).toBe('⚠');
    expect(STATUS_BADGE_TONE.external).toContain('purple');
    expect(STATUS_BADGE_GLYPH.crashed).toBe('✕');
    expect(STATUS_BADGE_TONE.crashed).toContain('rose');
  });

  test('starting + restarting include animation classes', () => {
    expect(STATUS_BADGE_TONE.starting).toContain('animate-pulse');
    expect(STATUS_BADGE_TONE.restarting).toContain('animate-spin');
  });
});
