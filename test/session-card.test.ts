import { describe, expect, test } from 'bun:test';

import type { TerminalInstance } from '../src/terminal-matrix/types.js';
import {
  AGENT_KIND_ICON,
  isAgentKind,
  listSessionCards,
  resolveAgentKindFromInstance,
  terminalToSessionCard,
  type SessionStatus,
} from '../src/session/card.js';

function stubInstance(over: Partial<TerminalInstance> = {}): TerminalInstance {
  const base = {
    id: 'term:1',
    title: 'shell',
    character: { kind: 'shell' as const },
    transport: { kind: 'local' as const },
    placement: { kind: 'background' as const },
    readOnly: false,
    visibility: 'both' as const,
    broadcastGroups: new Set<string>(),
    createdAt: 1_000,
    lastActivityAt: 1_500,
    exitCode: null,
    attentionLevel: 0 as const,
    metadata: {} as Record<string, unknown>,
    pty: {} as TerminalInstance['pty'],
  };
  return { ...base, ...over } as TerminalInstance;
}

describe('session-card', () => {
  test('ST2 — resolveAgentKindFromInstance prefers metadata.agentKind over character', () => {
    const t = stubInstance({
      character: { kind: 'shell' },
      metadata: { agentKind: 'claude-code' },
    });
    expect(resolveAgentKindFromInstance(t)).toBe('claude-code');

    const fallback = stubInstance({ character: { kind: 'codex' } });
    expect(resolveAgentKindFromInstance(fallback)).toBe('codex');

    const custom = stubInstance({ character: { kind: 'custom', name: 'ghostty' } });
    expect(resolveAgentKindFromInstance(custom)).toBe('other');

    const bogusMeta = stubInstance({ metadata: { agentKind: 'unknown-agent' } });
    expect(resolveAgentKindFromInstance(bogusMeta)).toBe('shell');
  });

  test('ST2 — terminalToSessionCard maps live PTY fields and defaults status to idle', () => {
    const t = stubInstance({
      id: 'term:7',
      title: 'claude',
      character: { kind: 'claude-code' },
      attentionLevel: 2,
      createdAt: 10,
      lastActivityAt: 50,
    });
    const card = terminalToSessionCard(t);
    expect(card).toEqual({
      id: 'term:7',
      source: 'pty',
      title: 'claude',
      agentKind: 'claude-code',
      status: 'idle',
      isAlive: true,
      attentionLevel: 2,
      lastActivityAt: 50,
      createdAt: 10,
      unreadCount: 0,
      meta: {},
    });
  });

  test('ST2 — terminalToSessionCard marks exited PTYs as !isAlive', () => {
    const card = terminalToSessionCard(stubInstance({ exitCode: 0 }));
    expect(card.isAlive).toBe(false);
  });

  test('ST2 — listSessionCards sorts alive-first, then by recent activity', () => {
    const terms = [
      stubInstance({ id: 'term:1', title: 'older', lastActivityAt: 100 }),
      stubInstance({ id: 'term:2', title: 'newer', lastActivityAt: 500 }),
      stubInstance({ id: 'term:3', title: 'dead',  lastActivityAt: 900, exitCode: 0 }),
    ];
    const cards = listSessionCards({ listTerminals: () => terms });
    expect(cards.map(c => c.id)).toEqual(['term:2', 'term:1', 'term:3']);
  });

  test('ST2 — status lookup flows into card.status', () => {
    const statusMap = new Map<string, SessionStatus>([['term:1', 'working']]);
    const cards = listSessionCards({
      listTerminals: () => [stubInstance({ id: 'term:1' })],
      status: { get: (id) => statusMap.get(id) },
    });
    expect(cards[0]!.status).toBe('working');
  });

  test('ST2 — ACP + scheduler stubs combine into the same list', () => {
    const cards = listSessionCards({
      listTerminals: () => [stubInstance({ id: 'term:1', title: 'pty' })],
      listAcpSessions: () => [{
        id: 'acp:abc',
        title: 'codex-acp',
        agentKind: 'codex',
        isAlive: true,
        lastActivityAt: 2_000,
      }],
      listSchedulerTriggers: () => [{
        id: 'cron:hello',
        title: 'hourly',
        isAlive: true,
        lastActivityAt: 3_000,
      }],
    });
    expect(cards.map(c => c.id)).toEqual(['cron:hello', 'acp:abc', 'term:1']);
    expect(cards.map(c => c.source)).toEqual(['scheduler', 'acp', 'pty']);
    expect(cards.find(c => c.id === 'acp:abc')?.agentKind).toBe('codex');
  });

  test('ST2 — AGENT_KIND_ICON covers every AgentKind + isAgentKind guard', () => {
    for (const kind of ['claude-code', 'codex', 'gemini-cli', 'aider', 'shell', 'background', 'other'] as const) {
      expect(isAgentKind(kind)).toBe(true);
      expect(AGENT_KIND_ICON[kind]).toMatch(/^.$/u); // single glyph
    }
    expect(isAgentKind('nonsense')).toBe(false);
    expect(isAgentKind(42)).toBe(false);
  });

  // ── Follow-up #3 — sidebar kind for background sessions ─────────

  test('followup-3 — AGENT_KIND_ICON.background is a single glyph (◎)', () => {
    expect(AGENT_KIND_ICON['background']).toBe('◎');
    expect(isAgentKind('background')).toBe(true);
  });

  // ── NT3 — notifications lookup ─────────────────────────────────

  test('NT3 — notifications lookup flows into card.unreadCount', () => {
    const counts = new Map<string, number>([['term:1', 5]]);
    const cards = listSessionCards({
      listTerminals: () => [stubInstance({ id: 'term:1' })],
      notifications: { unreadCount: (id) => counts.get(id) ?? 0 },
    });
    expect(cards[0]!.unreadCount).toBe(5);
  });

  test('NT3 — missing lookup defaults unreadCount to 0 for every source', () => {
    const cards = listSessionCards({
      listTerminals: () => [stubInstance({ id: 'term:1' })],
      listAcpSessions: () => [{ id: 'acp:a', title: 'acp', isAlive: true }],
      listSchedulerTriggers: () => [{ id: 'cron:c', title: 'cron', isAlive: true }],
    });
    for (const card of cards) {
      expect(card.unreadCount).toBe(0);
    }
  });
});
