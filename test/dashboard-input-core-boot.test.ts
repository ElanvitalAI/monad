import { describe, expect, test } from 'bun:test';

import { bootDashboardInputCore } from '../src/dashboard/input-core-boot.js';

describe('bootDashboardInputCore', () => {
  test('runs eager bootstrap hooks and forwards binding reports', () => {
    const events: string[] = [];
    let reported: unknown;

    const result = bootDashboardInputCore({
      initPaneSubstrate: () => { events.push('pane'); },
      registerCaptureRuntimes: () => { events.push('capture'); },
      wireAutoModeContextBridge: () => { events.push('auto'); },
      wireAndonContextBridge: () => { events.push('andon'); },
      wireBudgetContextBridge: () => { events.push('budget'); },
      wirePlanModeContextBridge: () => { events.push('plan'); },
      wireInputModeContextBridge: () => { events.push('input'); },
      initInputCoreUserBindings: ({ report }) => {
        report({ kind: 'loaded' });
        return { initial: 'bindings', dispose: () => {} };
      },
      report: (ev) => {
        reported = ev;
        events.push('report');
      },
    });

    expect(result?.initial).toBe('bindings');
    expect(reported).toEqual({ kind: 'loaded' });
    expect(events).toEqual([
      'pane',
      'capture',
      'auto',
      'andon',
      'budget',
      'plan',
      'input',
      'report',
    ]);
  });

  test('swallows bootstrap and binding init failures', () => {
    const result = bootDashboardInputCore({
      initPaneSubstrate: () => { throw new Error('boom'); },
      registerCaptureRuntimes: () => { throw new Error('boom'); },
      wireAutoModeContextBridge: () => { throw new Error('boom'); },
      wireAndonContextBridge: () => { throw new Error('boom'); },
      wireBudgetContextBridge: () => { throw new Error('boom'); },
      wirePlanModeContextBridge: () => { throw new Error('boom'); },
      wireInputModeContextBridge: () => { throw new Error('boom'); },
      initInputCoreUserBindings: () => { throw new Error('boom'); },
      report: () => {},
    });

    expect(result).toBeNull();
  });
});
