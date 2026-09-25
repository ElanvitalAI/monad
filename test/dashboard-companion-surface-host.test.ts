import { describe, expect, test } from 'bun:test';
import { createCompanionSurfaceHost } from '../src/dashboard/companion-surface-host.js';

describe('createCompanionSurfaceHost', () => {
  test('tracks open and docked state independently', () => {
    const host = createCompanionSurfaceHost('dashboard-main', ['scratch', 'memo'] as const);
    host.markOpen('scratch');
    expect(host.isOpen('scratch')).toBe(true);
    expect(host.isDocked('scratch')).toBe(false);
    host.markDocked('scratch');
    expect(host.isOpen('scratch')).toBe(false);
    expect(host.isDocked('scratch')).toBe(true);
    expect(host.isActive('scratch')).toBe(true);
    host.close('scratch');
    expect(host.isActive('scratch')).toBe(false);
  });

  test('toggleOpen returns the next visibility state', () => {
    const host = createCompanionSurfaceHost('dashboard-main', ['scratch'] as const);
    expect(host.toggleOpen('scratch')).toBe(true);
    expect(host.isOpen('scratch')).toBe(true);
    expect(host.toggleOpen('scratch')).toBe(false);
    expect(host.isOpen('scratch')).toBe(false);
  });

  test('disposes registered handles', () => {
    const host = createCompanionSurfaceHost('dashboard-main', ['scratch'] as const);
    let disposed = 0;
    host.setHandle('scratch', { dispose: () => { disposed += 1; } });
    host.disposeHandles();
    expect(disposed).toBe(1);
    expect(host.getHandle('scratch')).toBeUndefined();
  });
});
