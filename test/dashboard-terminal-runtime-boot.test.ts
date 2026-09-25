import { describe, expect, test } from 'bun:test';

import { bootDashboardTerminalRuntime } from '../src/dashboard/terminal-runtime-boot.js';

describe('bootDashboardTerminalRuntime', () => {
  test('wires session registry, matrix, bus, persistence, and approvers', () => {
    const events: string[] = [];
    const display = { kind: 'display' } as unknown as import('../src/display/coordinator.js').DisplayCoordinator;
    const displayEvents = { kind: 'events' } as unknown as import('../src/display/events.js').DisplayEventBus;
    const sessionRegistry = { id: 'sessions' } as unknown as import('../src/terminal/session-registry.js').TerminalSessionRegistry;
    const terminalRegistry = { id: 'matrix' } as unknown as import('../src/terminal-matrix/index.js').TerminalRegistry;
    const broadcastBus = { id: 'broadcast' };
    const channelBus = { id: 'channel' };

    const result = bootDashboardTerminalRuntime({
      display,
      displayEvents,
      initElementObservability: () => { events.push('observability'); },
      initDashboardTerminalSessions: (coordinator, eventBus) => {
        expect(coordinator).toBe(display);
        expect(eventBus).toBe(displayEvents);
        events.push('sessions');
        return sessionRegistry;
      },
      createTerminalRegistry: ({ sessionRegistry: sr, termSize }) => {
        expect(sr).toBe(sessionRegistry);
        expect(termSize().cols).toBe(120);
        events.push('registry');
        return terminalRegistry;
      },
      initTerminalMatrix: (registry) => {
        expect(registry).toBe(terminalRegistry);
        events.push('matrix');
        return terminalRegistry;
      },
      createBroadcastBus: (registry) => {
        expect(registry).toBe(terminalRegistry);
        events.push('broadcast');
        return broadcastBus;
      },
      getChannelBus: () => {
        events.push('channel');
        return channelBus;
      },
      wirePersistence: (registry) => {
        expect(registry).toBe(sessionRegistry);
        events.push('persist');
      },
      initDashboardApprovers: ({ coordinator, termSize, getTheme }) => {
        expect(coordinator).toBe(display);
        expect(termSize().rows).toBe(40);
        expect(getTheme()).toEqual({ accent: 'cyan' });
        events.push('approvers');
      },
      termSize: () => ({ cols: 120, rows: 40 }),
      getTheme: () => ({ accent: 'cyan' } as unknown as import('../src/theme/tokens.js').ThemeTokens),
    });

    expect(result).toEqual({
      sessionRegistry,
      terminalMatrix: terminalRegistry,
      broadcastBus,
      channelBus,
    });
    expect(events).toEqual([
      'observability',
      'sessions',
      'registry',
      'matrix',
      'broadcast',
      'channel',
      'persist',
      'approvers',
    ]);
  });
});
