// W9d-FU Z15.b · devices-boot composer.

import { describe, expect, test } from 'bun:test';
import {
  buildDevicesSubstrate,
  createDevicesFleetSourceErrorReporter,
  stopDevicesSubstrate,
} from '../../src/mission-templates/devices-boot';
import { staticDeviceFleetSource } from '../../src/mission-templates/device-detector';
import { jsonDevicesFleetSource } from '../../src/mission-templates/devices-json-source';

describe('buildDevicesSubstrate', () => {
  test('cronEnabled=false → null cron + skipReason', () => {
    const sub = buildDevicesSubstrate({
      source: staticDeviceFleetSource([]),
      cronEnabled: false,
    });
    expect(sub.cron).toBeNull();
    expect(sub.skipReason).toBe('devices-disabled-in-config');
    expect(sub.source).toBeDefined();
  });

  test('default → cron scheduled + source returned', () => {
    const sub = buildDevicesSubstrate({
      source: staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch' }]),
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    expect(sub.cron).not.toBeNull();
    expect(sub.skipReason).toBeUndefined();
    sub.cron?.stop();
  });

  test('router forwarded into cron', async () => {
    const calls: string[] = [];
    const router = { async route(e: { id: string }): Promise<unknown> { calls.push(e.id); return { ok: true }; } };
    const sub = buildDevicesSubstrate({
      source: staticDeviceFleetSource([{ deviceId: 'w', kind: 'watch' }]),
      router,
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    });
    await sub.cron?.tickOnce();
    expect(calls.length).toBe(1);
    sub.cron?.stop();
  });
});

describe('devices fleet source error reporting', () => {
  test('ENOENT is observed once across repeated reads and never warns', async () => {
    const warnings: string[] = [];
    const observed: Array<[string, string]> = [];
    const missing = Object.assign(new Error('devices.json not found'), { code: 'ENOENT' });
    const reporter = createDevicesFleetSourceErrorReporter({
      warn: (message) => { warnings.push(message); },
      observe: (category, event) => { observed.push([category, event]); },
    });
    const source = jsonDevicesFleetSource({
      read: () => { throw missing; },
      onError: reporter,
    });

    await source.read();
    await source.read();

    expect(warnings).toEqual([]);
    expect(observed).toEqual([['devices', 'fleet source absent: devices.json not found']]);
  });

  test('EACCES remains a warning with the unchanged devices prefix', async () => {
    const warnings: string[] = [];
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const source = jsonDevicesFleetSource({
      read: () => { throw denied; },
      onError: createDevicesFleetSourceErrorReporter({
        warn: (message) => { warnings.push(message); },
        observe: () => {},
      }),
    });

    await source.read();

    expect(warnings).toEqual(['[devices] fleet source: permission denied']);
  });

  test('JSON parse damage remains a warning with the unchanged devices prefix', async () => {
    const warnings: string[] = [];
    const source = jsonDevicesFleetSource({
      read: () => '{broken',
      onError: createDevicesFleetSourceErrorReporter({
        warn: (message) => { warnings.push(message); },
        observe: () => {},
      }),
    });

    await source.read();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith('[devices] fleet source: ');
  });
});

describe('stopDevicesSubstrate', () => {
  test('null cron → no-op', () => {
    expect(() => stopDevicesSubstrate(undefined)).not.toThrow();
    expect(() => stopDevicesSubstrate({ source: staticDeviceFleetSource([]), cron: null })).not.toThrow();
  });

  test('live cron → stop called + idempotent', () => {
    let cleared = 0;
    const sub = buildDevicesSubstrate({
      source: staticDeviceFleetSource([]),
      tickIntervalMs: 60_000,
      setIntervalImpl: ((_fn: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalImpl: (() => { cleared++; }) as typeof clearInterval,
    });
    stopDevicesSubstrate(sub);
    stopDevicesSubstrate(sub);
    expect(cleared).toBe(1);
  });
});
