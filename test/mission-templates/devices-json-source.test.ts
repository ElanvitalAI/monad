// W9d-FU Z15.b · devices.json reader → DeviceFleetSource.

import { describe, expect, test } from 'bun:test';
import {
  defaultDevicesJsonPath,
  jsonDevicesFleetSource,
} from '../../src/mission-templates/devices-json-source';

describe('defaultDevicesJsonPath', () => {
  test('lives under ~/.elanous', () => {
    const p = defaultDevicesJsonPath();
    expect(p).toMatch(/\.elanous\/devices\.json$/);
  });
});

describe('jsonDevicesFleetSource', () => {
  test('happy path → coerces rows + passes through optional fields', async () => {
    const src = jsonDevicesFleetSource({
      read: () => JSON.stringify([
        { deviceId: 'a', kind: 'iphone', model: 'iPhone15,3', capabilities: ['lidar'], lastSeenAt: 1000 },
        { deviceId: 'b', kind: 'watch' },
      ]),
    });
    const rows = await src.read();
    expect(rows.length).toBe(2);
    expect(rows[0]!.model).toBe('iPhone15,3');
    expect(rows[0]!.capabilities).toEqual(['lidar']);
    expect(rows[0]!.lastSeenAt).toBe(1000);
    expect(rows[1]!.deviceId).toBe('b');
  });

  test('missing file → [] + onError fires', async () => {
    let errored = false;
    const src = jsonDevicesFleetSource({
      read: () => { throw new Error('ENOENT'); },
      onError: () => { errored = true; },
    });
    expect(await src.read()).toEqual([]);
    expect(errored).toBe(true);
  });

  test('invalid JSON → [] + onError', async () => {
    let errored = false;
    const src = jsonDevicesFleetSource({
      read: () => 'not-json',
      onError: () => { errored = true; },
    });
    expect(await src.read()).toEqual([]);
    expect(errored).toBe(true);
  });

  test('non-array root → [] + onError', async () => {
    let errored = false;
    const src = jsonDevicesFleetSource({
      read: () => '{}',
      onError: () => { errored = true; },
    });
    expect(await src.read()).toEqual([]);
    expect(errored).toBe(true);
  });

  test('rejects rows missing deviceId or kind silently', async () => {
    const src = jsonDevicesFleetSource({
      read: () => JSON.stringify([
        { deviceId: '', kind: 'iphone' },
        { deviceId: 'a', kind: '' },
        { deviceId: 'a' /* no kind */ },
        { deviceId: 'good', kind: 'watch' },
      ]),
    });
    const rows = await src.read();
    expect(rows.length).toBe(1);
    expect(rows[0]!.deviceId).toBe('good');
  });

  test('drops non-string capability entries', async () => {
    const src = jsonDevicesFleetSource({
      read: () => JSON.stringify([
        { deviceId: 'a', kind: 'iphone', capabilities: ['lidar', 42, null, 'camera'] },
      ]),
    });
    const rows = await src.read();
    expect(rows[0]!.capabilities).toEqual(['lidar', 'camera']);
  });
});
