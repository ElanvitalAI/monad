// W9d-FU Z15.b · devices fleet cron · tick + OutboundRouter onChange.

import { describe, expect, test } from 'bun:test';
import {
  startDevicesFleetCron,
  type DevicesOutboundRouter,
} from '../../src/mission-templates/devices-cron';
import { staticDeviceFleetSource } from '../../src/mission-templates/device-detector';

function recorder(): DevicesOutboundRouter & { calls: Array<{ id: string; title: string; payload?: unknown }> } {
  const calls: Array<{ id: string; title: string; payload?: unknown }> = [];
  return {
    calls,
    async route(event) {
      calls.push({ id: event.id, title: event.title, payload: event.payload });
      return { ok: true };
    },
  };
}

describe('startDevicesFleetCron · tickOnce', () => {
  test('first tick fires reconfigure → router.route() called', async () => {
    const router = recorder();
    const handle = startDevicesFleetCron({
      source: staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] }]),
      router,
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
      now: () => 1000,
    });
    const { event } = await handle.tickOnce();
    expect(event.change.shouldReconfigure).toBe(true);
    expect(router.calls.length).toBe(1);
    expect(router.calls[0]!.title).toContain('watch');
    handle.stop();
  });

  test('idempotent tick (same fleet) → router only called once', async () => {
    const router = recorder();
    const source = staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch' }]);
    const handle = startDevicesFleetCron({
      source,
      router,
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    await handle.tickOnce();
    await handle.tickOnce();
    expect(router.calls.length).toBe(1);
    handle.stop();
  });

  test('no router → tick still observes change via onTick', async () => {
    let observed = 0;
    const handle = startDevicesFleetCron({
      source: staticDeviceFleetSource([{ deviceId: 'a', kind: 'airpods-pro' }]),
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
      onTick: () => { observed++; },
    });
    await handle.tickOnce();
    expect(observed).toBe(1);
    handle.stop();
  });

  test('diagnostics reflect tick count + last change kind', async () => {
    const router = recorder();
    const handle = startDevicesFleetCron({
      source: staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch' }]),
      router,
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    await handle.tickOnce();
    expect(handle.diagnostics().ticks).toBe(1);
    expect(handle.diagnostics().lastChangeKind).toBe('device-added');
    expect(handle.diagnostics().running).toBe(true);
    handle.stop();
    expect(handle.diagnostics().running).toBe(false);
  });

  test('router throw is swallowed by onError + tick still completes', async () => {
    const router: DevicesOutboundRouter = {
      async route() { throw new Error('apns down'); },
    };
    let observed = 0;
    const handle = startDevicesFleetCron({
      source: staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch' }]),
      router,
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
      onError: () => { observed++; },
    });
    await expect(handle.tickOnce()).resolves.toBeDefined();
    expect(observed).toBe(1);
    handle.stop();
  });

  test('stop is idempotent + interval cleared', async () => {
    let intervalsCleared = 0;
    const handle = startDevicesFleetCron({
      source: staticDeviceFleetSource([]),
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 42 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: ((_t: unknown) => { intervalsCleared++; }) as typeof clearInterval,
    });
    handle.stop();
    handle.stop();
    expect(intervalsCleared).toBe(1);
  });
});
