// ── B-13-α — DescribeSurface window branch · GetUIState kind filter ──

import { describe, expect, test } from 'bun:test';

import {
  dispatchDescribeSurface,
  dispatchGetUIState,
} from '../src/surface/llm-tools.js';
import { createSurfaceRegistry } from '../src/surface/registry.js';

describe('B-13-α · DescribeSurface + GetUIState with window kind', () => {
  test('DescribeSurface({kind:"window", windowId}) returns detail.windowId', () => {
    const reg = createSurfaceRegistry();
    reg.register({
      addr: { kind: 'window', windowId: 3 },
      kindTag: 'window',
      surfaceId: 'win:3',
      tier: 'window',
      visible: true,
      title: 'test-win',
    });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'window', windowId: 3 } },
      { registry: reg },
    );
    expect(out.found).toBe(true);
    expect(out.kindTag).toBe('window');
    expect(out.title).toBe('test-win');
    expect((out.detail as { windowId: number }).windowId).toBe(3);
  });

  test('DescribeSurface window kind — unregistered returns found:false', () => {
    const reg = createSurfaceRegistry();
    const out = dispatchDescribeSurface(
      { addr: { kind: 'window', windowId: 42 } },
      { registry: reg },
    );
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/not in registry/);
  });

  test('GetUIState({kind:"window"}) filters to window surfaces only', () => {
    const reg = createSurfaceRegistry();
    reg.register({
      addr: { kind: 'window', windowId: 1 },
      kindTag: 'window',
      visible: true,
      tier: 'window',
    });
    reg.register({
      addr: { kind: 'modal', modalId: 'm1' },
      kindTag: 'dialog',
      visible: true,
      tier: 'modal',
    });
    const out = dispatchGetUIState({ kind: 'window' }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]!.addr.kind).toBe('window');
  });
});
