import { describe, expect, test } from 'bun:test';

import {
  runDashboardAutoRouteCountdown,
  runDashboardTabConfirmRoute,
} from '../src/dashboard/skill-route-prompt.js';

describe('runDashboardAutoRouteCountdown', () => {
  test('returns true immediately when disabled', async () => {
    const ok = await runDashboardAutoRouteCountdown('demo', 0, {
      chatLines: [],
      pushDebugLine: () => {},
      draw: () => {},
      onEscAbort: () => () => {},
    });

    expect(ok).toBe(true);
  });

  test('returns false when escape aborts the countdown', async () => {
    const chatLines: string[] = [];
    const ok = await runDashboardAutoRouteCountdown('demo', 50, {
      chatLines,
      pushDebugLine: (line) => { chatLines.push(line); },
      draw: () => {},
      onEscAbort: (ctrl) => {
        ctrl.abort();
        return () => { chatLines.push('cleanup'); };
      },
      stepMs: 10,
      sleep: async () => {},
    });

    expect(ok).toBe(false);
    expect(chatLines).toContain('cleanup');
  });
});

describe('runDashboardTabConfirmRoute', () => {
  test('confirms when tab is pressed during the window', async () => {
    const chatLines: string[] = [];
    let handler: ((data: string | Buffer) => void) | null = null;

    const promise = runDashboardTabConfirmRoute('demo', 50, {
      chatLines,
      pushDebugLine: (line) => { chatLines.push(line); },
      draw: () => {},
      addInputListener: (next) => { handler = next; },
      removeInputListener: () => { handler = null; },
      stepMs: 10,
      sleep: async () => {
        handler?.('\t');
      },
    });

    await expect(promise).resolves.toBe(true);
    expect(handler).toBeNull();
  });

  test('falls through on non-tab input', async () => {
    let handler: ((data: string | Buffer) => void) | null = null;

    const promise = runDashboardTabConfirmRoute('demo', 50, {
      chatLines: [],
      pushDebugLine: () => {},
      draw: () => {},
      addInputListener: (next) => { handler = next; },
      removeInputListener: () => { handler = null; },
      stepMs: 10,
      sleep: async () => {
        handler?.('x');
      },
    });

    await expect(promise).resolves.toBe(false);
    expect(handler).toBeNull();
  });
});
