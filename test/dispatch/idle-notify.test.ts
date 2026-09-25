// ── §5-③ Phase D: shared idle detector + notifyDaemonActivity ──

import { describe, test, expect } from 'bun:test';
import { daemonIdleDetector, notifyDaemonActivity } from '../../src/dispatch/idle-detector';

describe('daemonIdleDetector / notifyDaemonActivity', () => {
  test('recording activity marks the shared detector not-idle', () => {
    daemonIdleDetector.reset();
    notifyDaemonActivity('test-surface');
    // within the 15-min threshold of the activity → not idle → the
    // continuation scheduler pauses while the operator is active.
    expect(daemonIdleDetector.isIdle()).toBe(false);
  });

  test('the default surface is accepted', () => {
    daemonIdleDetector.reset();
    notifyDaemonActivity(); // default surface
    expect(daemonIdleDetector.isIdle()).toBe(false);
  });
});
