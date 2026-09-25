import { describe, expect, test } from 'bun:test';

import {
  handleDashboardDisplayKeyRoute,
} from '../src/dashboard/input/dashboard-display-key-route.js';
import type { DisplayKeyRouteResult } from '../src/display/types.js';

describe('handleDashboardDisplayKeyRoute', () => {
  test('invokes handler routes and redraws', async () => {
    const calls: string[] = [];
    const route: DisplayKeyRouteResult = {
      type: 'handler',
      binding: { id: 'x', key: 'x', command: null, when: null },
      invoke: () => { calls.push('invoke'); },
    };

    const result = await handleDashboardDisplayKeyRoute(route, {
      invokeHandler: (invoke) => { invoke(); },
      runCommand: () => { calls.push('command'); },
      runAction: () => { calls.push('action'); },
      redraw: () => { calls.push('draw'); },
    });

    expect(result).toEqual({ type: 'handled' });
    expect(calls).toEqual(['invoke', 'draw']);
  });

  test('routes command and action without redraw', async () => {
    const calls: string[] = [];
    const commandRoute: DisplayKeyRouteResult = {
      type: 'command',
      binding: { id: 'x', key: 'x', command: 'foo', when: null },
      command: 'foo',
    };
    const actionRoute: DisplayKeyRouteResult = {
      type: 'action',
      surfaceId: 'surface-x',
      action: { type: 'noop' } as never,
    };

    await handleDashboardDisplayKeyRoute(commandRoute, {
      invokeHandler: () => { calls.push('invoke'); },
      runCommand: (command) => { calls.push(`command:${command}`); },
      runAction: (action) => { calls.push(`action:${String((action as { type: string }).type)}`); },
      redraw: () => { calls.push('draw'); },
    });
    await handleDashboardDisplayKeyRoute(actionRoute, {
      invokeHandler: () => { calls.push('invoke'); },
      runCommand: (command) => { calls.push(`command:${command}`); },
      runAction: (action) => { calls.push(`action:${String((action as { type: string }).type)}`); },
      redraw: () => { calls.push('draw'); },
    });

    expect(calls).toEqual(['command:foo', 'action:noop']);
  });

  test('redraws chord-armed and consumed routes', async () => {
    const calls: string[] = [];

    await handleDashboardDisplayKeyRoute({ type: 'chord-armed', prefix: 'C-b' }, {
      invokeHandler: () => { calls.push('invoke'); },
      runCommand: () => { calls.push('command'); },
      runAction: () => { calls.push('action'); },
      redraw: () => { calls.push('draw'); },
    });
    await handleDashboardDisplayKeyRoute({ type: 'consumed', surfaceId: 'surface-x' }, {
      invokeHandler: () => { calls.push('invoke'); },
      runCommand: () => { calls.push('command'); },
      runAction: () => { calls.push('action'); },
      redraw: () => { calls.push('draw'); },
    });

    expect(calls).toEqual(['draw', 'draw']);
  });

  test('passes through passthrough routes', async () => {
    const calls: string[] = [];

    const result = await handleDashboardDisplayKeyRoute({ type: 'passthrough' }, {
      invokeHandler: () => { calls.push('invoke'); },
      runCommand: () => { calls.push('command'); },
      runAction: () => { calls.push('action'); },
      redraw: () => { calls.push('draw'); },
    });

    expect(result).toEqual({ type: 'passthrough' });
    expect(calls).toEqual([]);
  });
});
