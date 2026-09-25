// W9b Z15.b · device fleet detector — dedup · stale drop · iPhone Pro promotion.

import { describe, expect, test } from 'bun:test';
import {
  detectFleet,
  isDeviceKind,
  staticDeviceFleetSource,
  type RawDeviceRow,
} from '../../src/mission-templates/device-detector';

const DAY = 24 * 60 * 60 * 1000;

function fleetFrom(rows: RawDeviceRow[]) {
  return staticDeviceFleetSource(rows);
}

describe('isDeviceKind', () => {
  test('canonical kinds pass', () => {
    for (const k of ['iphone', 'watch', 'airpods-pro', 'ipad', 'mac', 'vision-pro']) {
      expect(isDeviceKind(k)).toBe(true);
    }
  });
  test('non-strings + unknown strings reject', () => {
    expect(isDeviceKind(undefined)).toBe(false);
    expect(isDeviceKind('iphone-mini')).toBe(false);
    expect(isDeviceKind(42)).toBe(false);
  });
});

describe('detectFleet · normalisation', () => {
  test('unions capabilities across multiple rows for the same kind', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'a', kind: 'iphone', capabilities: ['camera'] },
        { deviceId: 'b', kind: 'iphone', capabilities: ['gps'] },
      ]),
      now: () => 1000,
    });
    expect(set.byKind.get('iphone')?.has('camera')).toBe(true);
    expect(set.byKind.get('iphone')?.has('gps')).toBe(true);
    expect(set.count('iphone')).toBe(2);
  });

  test('dedup keeps the most recent row per deviceId', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'd1', kind: 'watch', capabilities: ['old'], lastSeenAt: 1 },
        { deviceId: 'd1', kind: 'watch', capabilities: ['new'], lastSeenAt: 1000 },
      ]),
      now: () => 2000,
    });
    expect(set.count('watch')).toBe(1);
    expect(set.byKind.get('watch')?.has('new')).toBe(true);
    expect(set.byKind.get('watch')?.has('old')).toBe(false);
  });

  test('drops rows older than retentionMs', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'fresh', kind: 'watch',  capabilities: ['core-motion'], lastSeenAt: 100 },
        { deviceId: 'stale', kind: 'airpods-pro', capabilities: ['head-motion'], lastSeenAt: 10 },
      ]),
      retentionMs: 50,
      now: () => 100,
    });
    expect(set.count('watch')).toBe(1);
    expect(set.count('airpods-pro')).toBe(0);
  });

  test('promotes iPhone → iphone-pro when LiDAR capability is present', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'p1', kind: 'iphone', model: 'iPhone15,3', capabilities: ['lidar', 'camera'] },
      ]),
      now: () => 1000,
    });
    expect(set.count('iphone-pro')).toBe(1);
    expect(set.count('iphone')).toBe(0);
    expect(set.byKind.get('iphone-pro')?.has('lidar')).toBe(true);
  });

  test('promotes iPhone → iphone-pro by Pro/Max model string even without LiDAR cap', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'p2', kind: 'iphone', model: 'iPhone15 Pro Max', capabilities: [] },
      ]),
      now: () => 1000,
    });
    expect(set.count('iphone-pro')).toBe(1);
    expect(set.count('iphone')).toBe(0);
  });

  test('non-pro iPhone stays as iphone', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'b1', kind: 'iphone', model: 'iPhone13,1', capabilities: [] },
      ]),
      now: () => 1000,
    });
    expect(set.count('iphone')).toBe(1);
    expect(set.count('iphone-pro')).toBe(0);
  });

  test('has() unions capabilities across kinds', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'w', kind: 'watch',         capabilities: ['core-motion'] },
        { deviceId: 'a', kind: 'airpods-pro',   capabilities: ['head-motion'] },
      ]),
    });
    expect(set.has('core-motion')).toBe(true);
    expect(set.has('head-motion')).toBe(true);
    expect(set.has('lidar')).toBe(false);
  });

  test('rejects rows with unknown kind silently', async () => {
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'x', kind: 'mystery' as never },
        { deviceId: 'w', kind: 'watch' },
      ]),
    });
    expect(set.totalDevices).toBe(1);
    expect(set.count('watch')).toBe(1);
  });

  test('totalDevices reflects post-dedup count', async () => {
    // `now` close to lastSeenAt so neither row falls outside retention.
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'a', kind: 'iphone', lastSeenAt: 0 },
        { deviceId: 'a', kind: 'iphone', lastSeenAt: 100 },
        { deviceId: 'b', kind: 'watch' },
      ]),
      now: () => 200,
    });
    expect(set.totalDevices).toBe(2);
  });

  test('default retention is generous (90d) so reasonable lastSeenAt survives', async () => {
    const now = 100 * DAY;
    const set = await detectFleet({
      source: fleetFrom([
        { deviceId: 'recent', kind: 'watch', lastSeenAt: now - 30 * DAY },
      ]),
      now: () => now,
    });
    expect(set.count('watch')).toBe(1);
  });
});
