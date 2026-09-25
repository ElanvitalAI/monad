import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('R4 damage bridge source truth', () => {
  test('dashboard wires renderCoordinator before-flush into frame-cache row invalidation', () => {
    const dashboard = read('src/dashboard/index.ts');
    expect(dashboard).toContain("display.renderCoordinatorAPI().on('before-flush'");
    expect(dashboard).toContain('buildDamageFromDirtyEntries(ev.entries, display.layerTreeAPI())');
    expect(dashboard).toContain('invalidateRowsForDamage(damage, (row0) => invalidateRenderCacheRow(row0))');
  });

  test('drag wire cleanup no longer depends on shouldResetRenderCache or forceFromDrag', () => {
    const dashboard = read('src/dashboard/index.ts');
    const dragWire = read('src/drag-session-dashboard-wire.ts');
    const popover = read('src/drop-zone-popover.ts');
    expect(dashboard.includes('forceFromDrag')).toBe(false);
    expect(dashboard.includes('shouldResetRenderCache')).toBe(false);
    expect(dashboard).toContain('transientOverlayHost.prepareFrame()');
    expect(dragWire.includes('shouldResetRenderCache')).toBe(false);
    expect(dragWire).toContain('prepareOverlayFrame()');
    expect(dragWire.includes('skipSelfErase')).toBe(false);
    expect(popover.includes('skipSelfErase')).toBe(false);
  });
});
