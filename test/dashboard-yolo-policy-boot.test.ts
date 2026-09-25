import { describe, expect, test } from 'bun:test';

import { bootDashboardYoloPolicy } from '../src/dashboard/yolo-policy-boot.js';

describe('bootDashboardYoloPolicy', () => {
  test('enables unsupervised policy and announces it when yolo is on', () => {
    const events: string[] = [];
    bootDashboardYoloPolicy({
      enabled: true,
      setPolicy: () => { events.push('set-policy'); },
      pushWarningLine: (message) => { events.push(`warning:${message}`); },
      pushMutedLine: (message) => { events.push(`muted:${message}`); },
    });
    expect(events).toEqual([
      'set-policy',
      'warning:[yolo] code-edit policy: UNSUPERVISED — every Edit/Write applies without approval.',
      'muted:[yolo] flip back with /code-edit policy ask-edit',
    ]);
  });

  test('does nothing when yolo is off', () => {
    const events: string[] = [];
    bootDashboardYoloPolicy({
      enabled: false,
      setPolicy: () => { events.push('set-policy'); },
      pushWarningLine: () => { events.push('warning'); },
      pushMutedLine: () => { events.push('muted'); },
    });
    expect(events).toEqual([]);
  });
});
