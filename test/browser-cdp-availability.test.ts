import { describe, expect, test } from 'bun:test';

import { getBrowserCdpAvailability } from '../src/browser-cdp/availability.js';

describe('browser cdp availability', () => {
  test('returns a stable degraded note when chrome is unavailable', () => {
    const availability = getBrowserCdpAvailability();
    if (!availability.available) {
      expect(availability.reason).toBe('no-chrome-binary');
      expect(availability.note).toContain('Chrome unavailable');
      return;
    }
    expect(availability.reason).toBe('ok');
    expect(availability.binary).toBeTruthy();
    expect(availability.note).toContain('Chrome available');
  });
});
