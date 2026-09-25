import { describe, expect, test } from 'bun:test';
import { createCompanionSurfaceHostRegistry } from '../src/dashboard/companion-surface-host-registry.js';

describe('createCompanionSurfaceHostRegistry', () => {
  test('returns the same host for repeated ensure calls', () => {
    const registry = createCompanionSurfaceHostRegistry<'clipboard' | 'memo'>();
    const first = registry.ensure('dashboard-main', ['clipboard', 'memo']);
    const second = registry.ensure('dashboard-main', ['clipboard', 'memo']);
    expect(second).toBe(first);
    expect(registry.listOwnerIds()).toEqual(['dashboard-main']);
  });

  test('stores separate hosts per owner', () => {
    const registry = createCompanionSurfaceHostRegistry<'clipboard'>();
    const dashboard = registry.ensure('dashboard-main', ['clipboard']);
    const vw = registry.ensure('virtual-window:7', ['clipboard']);
    expect(vw).not.toBe(dashboard);
    expect(registry.get('virtual-window:7')).toBe(vw);
  });
});
