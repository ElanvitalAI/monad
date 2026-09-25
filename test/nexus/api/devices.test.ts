// W9c Z13-d · GET /v1/devices + POST /v1/templates/capability-preview wire.

import { describe, expect, test } from 'bun:test';
import {
  DEVICES_PATH,
  TEMPLATE_CAPABILITY_PREVIEW_PATH,
  handleDevices,
  handleTemplateCapabilityPreview,
  isDevicesPath,
  isTemplateCapabilityPreviewPath,
} from '../../../src/nexus/api/devices';
import { staticDeviceFleetSource } from '../../../src/mission-templates/device-detector';

function makeFleet() {
  return staticDeviceFleetSource([
    { deviceId: 'w', kind: 'watch', capabilities: ['core-motion', 'workout-bg'] },
    { deviceId: 'a', kind: 'airpods-pro', capabilities: ['head-motion'] },
    { deviceId: 'p', kind: 'iphone', model: 'iPhone15 Pro', capabilities: ['lidar'] },
  ]);
}

describe('path matchers', () => {
  test('isDevicesPath exact match', () => {
    expect(isDevicesPath(DEVICES_PATH)).toBe(true);
    expect(isDevicesPath('/v1/devices/')).toBe(false);
  });
  test('isTemplateCapabilityPreviewPath exact match', () => {
    expect(isTemplateCapabilityPreviewPath(TEMPLATE_CAPABILITY_PREVIEW_PATH)).toBe(true);
    expect(isTemplateCapabilityPreviewPath('/v1/templates/')).toBe(false);
  });
});

describe('GET /v1/devices', () => {
  test('returns sorted kind list with counts + capabilities', async () => {
    const req = new Request(`http://x${DEVICES_PATH}`);
    const res = await handleDevices(req, { fleetSource: makeFleet(), now: () => 1000 });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalDevices: number; kinds: Array<{ kind: string; count: number; capabilities: string[] }> };
    expect(body.totalDevices).toBe(3);
    const kinds = body.kinds.map((k) => k.kind);
    expect(kinds).toEqual(['airpods-pro', 'iphone-pro', 'watch']);
    const watch = body.kinds.find((k) => k.kind === 'watch')!;
    expect(watch.capabilities).toEqual(['core-motion', 'workout-bg']);
    expect(watch.count).toBe(1);
  });

  test('405 on non-GET', async () => {
    const req = new Request(`http://x${DEVICES_PATH}`, { method: 'POST' });
    const res = await handleDevices(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(405);
  });

  test('401 when checkAuth fails', async () => {
    const req = new Request(`http://x${DEVICES_PATH}`);
    const res = await handleDevices(req, { fleetSource: makeFleet(), checkAuth: () => false });
    expect(res.status).toBe(401);
  });

  test('empty fleet → totalDevices=0 and empty kinds[]', async () => {
    const req = new Request(`http://x${DEVICES_PATH}`);
    const res = await handleDevices(req, { fleetSource: staticDeviceFleetSource([]) });
    const body = await res.json() as { totalDevices: number; kinds: unknown[] };
    expect(body.totalDevices).toBe(0);
    expect(body.kinds.length).toBe(0);
  });
});

describe('POST /v1/templates/capability-preview', () => {
  const lectureBody = {
    optionalRequirements: [
      { device: 'watch', capability: ['core-motion', 'workout-bg'],
        enables: ['recording-motion-trigger'], degrade_to: 'manual-recording-button-pwa' },
      { device: 'airpods-pro', capability: 'head-motion',
        enables: ['intent-head-nod-fire'], degrade_to: 'tap-fire-only' },
      { device: 'iphone-pro', capability: 'lidar',
        enables: ['whiteboard-perspective-correction'], degrade_to: 'standard-ocr' },
    ],
    fallbackChain: [
      { if: 'no ipad && no mac', then: 'iPhone PWA single-window mode' },
    ],
  };

  test('full fleet → all enables fired, no degraded markers', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, {
      method: 'POST',
      body: JSON.stringify(lectureBody),
    });
    const res = await handleTemplateCapabilityPreview(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: string[]; degraded: string[]; fallbackHits: string[] };
    expect(body.enabled).toEqual(expect.arrayContaining([
      'recording-motion-trigger', 'intent-head-nod-fire', 'whiteboard-perspective-correction',
    ]));
    expect(body.degraded.length).toBe(0);
    // No ipad, no mac → fallback fires
    expect(body.fallbackHits).toEqual(['iPhone PWA single-window mode']);
  });

  test('iPhone-only fleet → all 3 degraded + fallback fired', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, {
      method: 'POST',
      body: JSON.stringify(lectureBody),
    });
    const res = await handleTemplateCapabilityPreview(req, {
      fleetSource: staticDeviceFleetSource([{ deviceId: 'p', kind: 'iphone', model: 'iPhone13' }]),
    });
    const body = await res.json() as { enabled: string[]; degraded: string[]; fallbackHits: string[] };
    expect(body.enabled.length).toBe(0);
    expect(body.degraded).toEqual(expect.arrayContaining([
      'manual-recording-button-pwa', 'tap-fire-only', 'standard-ocr',
    ]));
  });

  test('400 on missing optionalRequirements', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleTemplateCapabilityPreview(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(400);
  });

  test('400 on invalid JSON', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, {
      method: 'POST',
      body: 'not-json',
    });
    const res = await handleTemplateCapabilityPreview(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(400);
  });

  test('405 on non-POST', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, { method: 'GET' });
    const res = await handleTemplateCapabilityPreview(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(405);
  });

  test('skips malformed requirement rows silently', async () => {
    const req = new Request(`http://x${TEMPLATE_CAPABILITY_PREVIEW_PATH}`, {
      method: 'POST',
      body: JSON.stringify({
        optionalRequirements: [
          { device: 'watch', degrade_to: 'x' }, // missing capability + enables
          { device: 'airpods-pro', capability: 'head-motion', enables: ['ok'], degrade_to: 'tap-fire-only' },
        ],
      }),
    });
    const res = await handleTemplateCapabilityPreview(req, { fleetSource: makeFleet() });
    expect(res.status).toBe(200);
    const body = await res.json() as { decisions: unknown[] };
    expect(body.decisions.length).toBe(1);
  });
});
