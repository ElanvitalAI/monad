// W9b Z15.b · device fleet upgrade watcher — signature diff + tick orchestrator.

import { describe, expect, test } from 'bun:test';
import {
  compareFleets,
  createFleetWatcherState,
  fleetSignature,
  tickUpgradeWatcher,
  type FleetSignature,
} from '../../src/mission-templates/upgrade-watcher';
import {
  detectFleet,
  staticDeviceFleetSource,
  type DeviceCapabilitySet,
  type RawDeviceRow,
} from '../../src/mission-templates/device-detector';

async function makeFleet(rows: RawDeviceRow[]): Promise<DeviceCapabilitySet> {
  return detectFleet({ source: staticDeviceFleetSource(rows), now: () => 100 });
}

const empty: FleetSignature = { kinds: {}, capabilities: {} };

describe('fleetSignature', () => {
  test('extracts kind counts + capability keys', async () => {
    const fleet = await makeFleet([
      { deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] },
      { deviceId: 'p', kind: 'iphone', model: 'iPhone15 Pro', capabilities: ['lidar'] },
    ]);
    const sig = fleetSignature(fleet);
    expect(sig.kinds).toEqual({ 'watch': 1, 'iphone-pro': 1 });
    expect(sig.capabilities).toEqual({ 'core-motion': true, 'lidar': true });
  });
});

describe('compareFleets', () => {
  test('device-added on new kind appearance', () => {
    const next: FleetSignature = { kinds: { watch: 1 }, capabilities: { 'core-motion': true } };
    const change = compareFleets(empty, next);
    expect(change.kind).toBe('device-added');
    expect(change.devicesAdded).toEqual(['watch']);
    expect(change.capabilitiesAdded).toEqual(['core-motion']);
    expect(change.shouldReconfigure).toBe(true);
  });

  test('device-removed when kind count drops to 0', () => {
    const prev: FleetSignature = { kinds: { watch: 1 }, capabilities: { 'core-motion': true } };
    const change = compareFleets(prev, empty);
    expect(change.kind).toBe('device-removed');
    expect(change.devicesRemoved).toEqual(['watch']);
    expect(change.capabilitiesRemoved).toEqual(['core-motion']);
    expect(change.shouldReconfigure).toBe(true);
  });

  test('capability-added without new kind (firmware update)', () => {
    const prev: FleetSignature = { kinds: { watch: 1 }, capabilities: { 'core-motion': true } };
    const next: FleetSignature = { kinds: { watch: 1 }, capabilities: { 'core-motion': true, 'workout-bg': true } };
    const change = compareFleets(prev, next);
    expect(change.kind).toBe('capability-added');
    expect(change.devicesAdded.length).toBe(0);
    expect(change.capabilitiesAdded).toEqual(['workout-bg']);
    expect(change.shouldReconfigure).toBe(true);
  });

  test('no-change when signatures match', () => {
    const sig: FleetSignature = { kinds: { iphone: 1 }, capabilities: { camera: true } };
    const change = compareFleets(sig, sig);
    expect(change.kind).toBe('no-change');
    expect(change.shouldReconfigure).toBe(false);
  });

  test('kind count change at >0 levels is NOT a device-added (still same kind owned)', () => {
    const prev: FleetSignature = { kinds: { ipad: 1 }, capabilities: {} };
    const next: FleetSignature = { kinds: { ipad: 2 }, capabilities: {} };
    const change = compareFleets(prev, next);
    expect(change.devicesAdded.length).toBe(0);
    expect(change.shouldReconfigure).toBe(false);
  });
});

describe('tickUpgradeWatcher', () => {
  test('first tick fires reconfigure with all kinds + capabilities as added', async () => {
    const state = createFleetWatcherState();
    const fleet = await makeFleet([
      { deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] },
    ]);
    let observed = 0;
    const event = await tickUpgradeWatcher(state, fleet, {
      onChange: () => { observed++; },
      now: () => 999,
    });
    expect(event.change.shouldReconfigure).toBe(true);
    expect(event.change.devicesAdded).toEqual(['watch']);
    expect(event.observedAt).toBe(999);
    expect(observed).toBe(1);
    expect(state.lastSignature?.kinds.watch).toBe(1);
  });

  test('idempotent tick (same fleet) does not fire onChange', async () => {
    const state = createFleetWatcherState();
    const fleet = await makeFleet([{ deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] }]);
    let observed = 0;
    await tickUpgradeWatcher(state, fleet, { onChange: () => { observed++; } });
    await tickUpgradeWatcher(state, fleet, { onChange: () => { observed++; } });
    expect(observed).toBe(1);
  });

  test('device added between ticks fires onChange', async () => {
    const state = createFleetWatcherState();
    const f1 = await makeFleet([{ deviceId: 'p', kind: 'iphone' }]);
    const f2 = await makeFleet([
      { deviceId: 'p', kind: 'iphone' },
      { deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] },
    ]);
    let event2: unknown = null;
    await tickUpgradeWatcher(state, f1);
    await tickUpgradeWatcher(state, f2, { onChange: (e) => { event2 = e; } });
    expect((event2 as { change: { kind: string } } | null)?.change.kind).toBe('device-added');
  });

  test('onChange throw does not abort tick (best-effort)', async () => {
    const state = createFleetWatcherState();
    const fleet = await makeFleet([{ deviceId: 'w', kind: 'watch' }]);
    await expect(
      tickUpgradeWatcher(state, fleet, { onChange: () => { throw new Error('surface down'); } }),
    ).resolves.toBeDefined();
    // State pointer still advances.
    expect(state.lastSignature).not.toBeNull();
  });
});
