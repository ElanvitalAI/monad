// ── IUL Bundle 4T Phase 2 — popover-surface-adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  registerPopoverSurface,
  unregisterPopoverSurface,
  popoverIdFromAnchor,
  createSurfaceRegistry,
} from '../src/surface/index.js';

describe('popover-surface-adapter', () => {
  test('registerPopoverSurface adds {kind:popover} entry with defaults', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({ registry: reg, popoverId: 'pp-1' });
    const desc = reg.get({ kind: 'popover', popoverId: 'pp-1' });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('popover');
    expect(desc!.tier).toBe('popup');
    expect(desc!.visible).toBe(true);
    expect(desc!.surfaceId).toBe('pp-1');
  });

  test('overrides apply: kindTag / tier / title / zHint / visible', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({
      registry: reg,
      popoverId: 'menu-1',
      kindTag: 'context-menu',
      tier: 'menu',
      title: 'Right-click menu',
      zHint: 12,
      visible: false,
    });
    const d = reg.get({ kind: 'popover', popoverId: 'menu-1' });
    expect(d!.kindTag).toBe('context-menu');
    expect(d!.tier).toBe('menu');
    expect(d!.title).toBe('Right-click menu');
    expect(d!.zHint).toBe(12);
    expect(d!.visible).toBe(false);
  });

  test('anchorId surfaces in stateHash for traceability', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({
      registry: reg,
      popoverId: 'tooltip-7',
      anchorId: 'pill-modelName',
    });
    expect(reg.get({ kind: 'popover', popoverId: 'tooltip-7' })!.stateHash)
      .toBe('anchor:pill-modelName');
  });

  test('unregisterPopoverSurface returns true on hit, false on miss', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({ registry: reg, popoverId: 'x' });
    expect(unregisterPopoverSurface('x', reg)).toBe(true);
    expect(unregisterPopoverSurface('x', reg)).toBe(false);
  });

  test('popoverIdFromAnchor produces a stable derived id', () => {
    const a = popoverIdFromAnchor('pill-mode');
    const b = popoverIdFromAnchor('pill-mode');
    expect(a).toBe(b);
    expect(a).toBe('popover-of-pill-mode');
  });

  test('multiple popovers each get their own entry', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({ registry: reg, popoverId: 'p1' });
    registerPopoverSurface({ registry: reg, popoverId: 'p2' });
    registerPopoverSurface({ registry: reg, popoverId: 'p3' });
    expect(reg.listByKind('popover')).toHaveLength(3);
  });

  test('re-register overwrites prior entry (same popoverId)', () => {
    const reg = createSurfaceRegistry();
    registerPopoverSurface({ registry: reg, popoverId: 'pp', title: 'A' });
    registerPopoverSurface({ registry: reg, popoverId: 'pp', title: 'B' });
    expect(reg.get({ kind: 'popover', popoverId: 'pp' })!.title).toBe('B');
  });

  test('uses global registry when registry option omitted', () => {
    // Smoke — adapter doesn't crash without explicit registry
    registerPopoverSurface({ popoverId: 'global-test-popover' });
    expect(unregisterPopoverSurface('global-test-popover')).toBe(true);
  });
});
