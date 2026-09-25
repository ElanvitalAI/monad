// W9b Z15.b · capability resolver — `requires.optional` evaluation +
// fallback chain.

import { describe, expect, test } from 'bun:test';
import {
  detectFleet,
  staticDeviceFleetSource,
  type DeviceCapabilitySet,
  type RawDeviceRow,
} from '../../src/mission-templates/device-detector';
import {
  evalFallbackExpr,
  hasAnyEnablement,
  resolveCapabilities,
  type FallbackChainEntry,
  type OptionalRequirement,
} from '../../src/mission-templates/capability-resolver';

async function makeFleet(rows: RawDeviceRow[]): Promise<DeviceCapabilitySet> {
  return detectFleet({ source: staticDeviceFleetSource(rows), now: () => 100 });
}

const watchReq: OptionalRequirement = {
  device: 'watch',
  capability: ['core-motion', 'workout-bg'],
  enables: ['recording-motion-trigger', 'lecture-90min-bg'],
  degrade_to: 'manual-recording-button-pwa',
};

const airpodsReq: OptionalRequirement = {
  device: 'airpods-pro',
  capability: 'head-motion',
  enables: ['intent-head-nod-fire'],
  degrade_to: 'tap-fire-only',
};

const lidarReq: OptionalRequirement = {
  device: 'iphone-pro',
  capability: 'lidar',
  enables: ['whiteboard-perspective-correction'],
  degrade_to: 'standard-ocr',
};

describe('resolveCapabilities', () => {
  test('all met → all enabled', async () => {
    const fleet = await makeFleet([
      { deviceId: 'w',  kind: 'watch',         capabilities: ['core-motion', 'workout-bg'] },
      { deviceId: 'a',  kind: 'airpods-pro',   capabilities: ['head-motion'] },
      { deviceId: 'p',  kind: 'iphone', model: 'iPhone15 Pro', capabilities: ['lidar'] },
    ]);
    const result = resolveCapabilities({
      optionalRequirements: [watchReq, airpodsReq, lidarReq],
      fleet,
    });
    expect(result.enablement.enabled).toEqual(new Set([
      'recording-motion-trigger', 'lecture-90min-bg',
      'intent-head-nod-fire',
      'whiteboard-perspective-correction',
    ]));
    expect(result.enablement.degraded.size).toBe(0);
  });

  test('missing device → degrade with `device:<kind>` marker', async () => {
    const fleet = await makeFleet([
      { deviceId: 'a', kind: 'airpods-pro', capabilities: ['head-motion'] },
    ]);
    const result = resolveCapabilities({
      optionalRequirements: [watchReq],
      fleet,
    });
    expect(result.enablement.degraded.has('manual-recording-button-pwa')).toBe(true);
    const decision = result.enablement.decisions[0]!;
    expect(decision.outcome.status).toBe('degraded');
    if (decision.outcome.status === 'degraded') {
      expect(decision.outcome.missing).toEqual(['device:watch']);
    }
  });

  test('device present but capability missing → degrade with capability marker', async () => {
    const fleet = await makeFleet([
      { deviceId: 'w', kind: 'watch', capabilities: ['core-motion'] /* no workout-bg */ },
    ]);
    const result = resolveCapabilities({
      optionalRequirements: [watchReq],
      fleet,
    });
    const decision = result.enablement.decisions[0]!;
    expect(decision.outcome.status).toBe('degraded');
    if (decision.outcome.status === 'degraded') {
      expect(decision.outcome.missing).toEqual(['capability:workout-bg']);
    }
  });

  test('single-string capability AND-joins trivially', async () => {
    const fleet = await makeFleet([
      { deviceId: 'a', kind: 'airpods-pro', capabilities: ['head-motion'] },
    ]);
    const result = resolveCapabilities({
      optionalRequirements: [airpodsReq],
      fleet,
    });
    expect(result.enablement.enabled.has('intent-head-nod-fire')).toBe(true);
  });

  test('hasAnyEnablement reflects enabled-set non-empty', async () => {
    const fleet = await makeFleet([
      { deviceId: 'a', kind: 'airpods-pro', capabilities: ['head-motion'] },
    ]);
    const result = resolveCapabilities({
      optionalRequirements: [airpodsReq],
      fleet,
    });
    expect(hasAnyEnablement(result.enablement)).toBe(true);
  });
});

describe('evalFallbackExpr', () => {
  test('"no watch && no airpods-pro" fires when both absent', async () => {
    const fleet = await makeFleet([{ deviceId: 'p', kind: 'iphone' }]);
    expect(evalFallbackExpr('no watch && no airpods-pro', fleet)).toBe(true);
  });

  test('"no watch && no airpods-pro" does not fire when one is present', async () => {
    const fleet = await makeFleet([{ deviceId: 'w', kind: 'watch' }]);
    expect(evalFallbackExpr('no watch && no airpods-pro', fleet)).toBe(false);
  });

  test('"no ipad || no mac" fires when either is missing', async () => {
    const fleet = await makeFleet([{ deviceId: 'm', kind: 'mac' }]);
    expect(evalFallbackExpr('no ipad || no mac', fleet)).toBe(true);
  });

  test('"has watch" fires when at least one watch present', async () => {
    const fleet = await makeFleet([{ deviceId: 'w', kind: 'watch' }]);
    expect(evalFallbackExpr('has watch', fleet)).toBe(true);
  });

  test('malformed clause returns false (KISS grammar)', async () => {
    const fleet = await makeFleet([{ deviceId: 'w', kind: 'watch' }]);
    expect(evalFallbackExpr('watch is awesome', fleet)).toBe(false);
    expect(evalFallbackExpr('', fleet)).toBe(false);
  });
});

describe('resolveCapabilities · fallbackChain', () => {
  test('fallbackHits in declared order', async () => {
    const fleet = await makeFleet([]);
    const chain: FallbackChainEntry[] = [
      { if: 'no watch && no airpods-pro', then: 'PWA recording button + manual intent click' },
      { if: 'no ipad && no mac',           then: 'iPhone PWA single-window mode' },
    ];
    const result = resolveCapabilities({
      optionalRequirements: [],
      fallbackChain: chain,
      fleet,
    });
    expect(result.fallbackHits).toEqual([
      'PWA recording button + manual intent click',
      'iPhone PWA single-window mode',
    ]);
  });

  test('fallbackHits skips unmet clauses', async () => {
    const fleet = await makeFleet([{ deviceId: 'm', kind: 'mac' }]);
    const result = resolveCapabilities({
      optionalRequirements: [],
      fallbackChain: [
        { if: 'no mac', then: 'A' },
        { if: 'no watch', then: 'B' },
      ],
      fleet,
    });
    expect(result.fallbackHits).toEqual(['B']);
  });
});
