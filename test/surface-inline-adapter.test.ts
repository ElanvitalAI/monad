// ── IUL Bundle 4T Phase 2 — inline-surface-adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  registerInlineSurface,
  unregisterInlineSurface,
  bindInlineSurfaceToRegistry,
  createSurfaceRegistry,
  type InlineSurfaceLike,
} from '../src/surface/index.js';

function fakeInlineSurface(id: string): InlineSurfaceLike & { detached: number } {
  let detached = 0;
  return {
    latest: () => ({ id, status: 'running' }),
    detach: () => { detached++; },
    get detached() { return detached; },
  };
}

describe('inline-surface-adapter', () => {
  test('registerInlineSurface adds {kind:inline} entry with defaults', () => {
    const reg = createSurfaceRegistry();
    registerInlineSurface({ registry: reg, inlineId: 'sh-1' });
    const desc = reg.get({ kind: 'inline', inlineId: 'sh-1' });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('shell-inline');
    expect(desc!.tier).toBe('inline');
    expect(desc!.surfaceId).toBe('sh-1');
    expect(desc!.visible).toBe(true);
  });

  test('overrides apply', () => {
    const reg = createSurfaceRegistry();
    registerInlineSurface({
      registry: reg,
      inlineId: 'sh-2',
      kindTag: 'pty-inline',
      title: 'npm test',
      tier: 'vw',
      visible: false,
      zHint: 3,
    });
    const d = reg.get({ kind: 'inline', inlineId: 'sh-2' })!;
    expect(d.kindTag).toBe('pty-inline');
    expect(d.title).toBe('npm test');
    expect(d.tier).toBe('vw');
    expect(d.visible).toBe(false);
    expect(d.zHint).toBe(3);
  });

  test('unregisterInlineSurface returns true/false correctly', () => {
    const reg = createSurfaceRegistry();
    registerInlineSurface({ registry: reg, inlineId: 'a' });
    expect(unregisterInlineSurface('a', reg)).toBe(true);
    expect(unregisterInlineSurface('a', reg)).toBe(false);
  });

  test('bindInlineSurfaceToRegistry registers + dispose unregisters + detaches surface', () => {
    const reg = createSurfaceRegistry();
    const surface = fakeInlineSurface('sh-bound');
    const handle = bindInlineSurfaceToRegistry(surface, {
      registry: reg,
      inlineId: 'sh-bound',
      title: 'sh status',
    });
    expect(reg.get({ kind: 'inline', inlineId: 'sh-bound' })).toBeDefined();
    handle.dispose();
    expect(reg.get({ kind: 'inline', inlineId: 'sh-bound' })).toBeUndefined();
    expect(surface.detached).toBe(1);
  });

  test('bind onVisibilityChange fires false on dispose', () => {
    const reg = createSurfaceRegistry();
    const surface = fakeInlineSurface('sh-vis');
    const seen: boolean[] = [];
    const handle = bindInlineSurfaceToRegistry(surface, {
      registry: reg,
      inlineId: 'sh-vis',
      onVisibilityChange: (v) => seen.push(v),
    });
    handle.dispose();
    expect(seen).toEqual([false]);
  });
});
