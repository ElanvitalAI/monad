// ── Bundle 7T Phase 1 — DescribeSurface widget WR-2 consumption tests ──
//
// Validates that DescribeSurface widget branch consumes the optional
// WR-2 public APIs (describeSurfaceFor + snapshotHashFor) when
// available, and gracefully returns null for older hosts.

import { describe, expect, test } from 'bun:test';
import {
  dispatchDescribeSurface,
  createSurfaceRegistry,
  type SurfaceUIWidgetHost,
} from '../src/surface/index.js';

function hostWithWR2(opts: {
  id: string;
  type: string;
  character: string;
  state: unknown;
  description?: string;
  surfaceDesc?: string | null;
  hash?: string | null;
}): SurfaceUIWidgetHost {
  return {
    get: (id) => id === opts.id
      ? { id: opts.id, type: opts.type, character: opts.character, state: opts.state }
      : null,
    defFor: (id) => id === opts.id
      ? { type: opts.type, description: opts.description ?? '' }
      : null,
    listInstanceIds: () => [opts.id],
    describeSurfaceFor: (id) => id === opts.id ? (opts.surfaceDesc ?? null) : null,
    snapshotHashFor: (id) => id === opts.id ? (opts.hash ?? null) : null,
  };
}

function hostWithoutWR2(opts: {
  id: string; type: string; character: string; state: unknown;
}): SurfaceUIWidgetHost {
  return {
    get: (id) => id === opts.id
      ? { id: opts.id, type: opts.type, character: opts.character, state: opts.state }
      : null,
    defFor: (id) => id === opts.id ? { type: opts.type, description: '' } : null,
    listInstanceIds: () => [opts.id],
    // describeSurfaceFor + snapshotHashFor omitted (older host simulation)
  };
}

describe('DescribeSurface · WR-2 + Phase Z consumption', () => {
  test('WR-2 APIs populate detail.surfaceDescription + stateHash', () => {
    const reg = createSurfaceRegistry();
    const host = hostWithWR2({
      id: 'spark-1', type: 'sparkline', character: 'Spark',
      state: { values: [1, 2, 3] },
      description: 'small line chart',
      surfaceDesc: 'Sparkline · 3 values · trending up',
      hash: 'a7b2c9',
    });
    reg.register({
      addr: { kind: 'widget', widgetId: 'spark-1' },
      kindTag: 'sparkline',
      tier: 'vw',
      title: 'sparkline(spark-1)',
      zHint: 2,
    });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'spark-1' } },
      { registry: reg, widgetHost: host },
    );
    expect(out.found).toBe(true);
    expect(out.detail).toMatchObject({
      instanceId: 'spark-1',
      type: 'sparkline',
      surfaceDescription: 'Sparkline · 3 values · trending up',
      stateHash: 'a7b2c9',
      zTier: 'vw',
      zIndex: 2,
    });
  });

  test('older host (no WR-2) → surfaceDescription + stateHash null', () => {
    const reg = createSurfaceRegistry();
    const host = hostWithoutWR2({
      id: 'w1', type: 'fake', character: 'F', state: {},
    });
    reg.register({
      addr: { kind: 'widget', widgetId: 'w1' },
      kindTag: 'fake', tier: 'vw', title: 'fake(w1)',
    });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'w1' } },
      { registry: reg, widgetHost: host },
    );
    expect(out.found).toBe(true);
    expect(out.detail).toMatchObject({
      surfaceDescription: null,
      stateHash: null,
    });
  });

  test('WR-2 host returning null values → detail reflects null (no override)', () => {
    const reg = createSurfaceRegistry();
    const host = hostWithWR2({
      id: 'x', type: 'generic', character: 'X', state: {},
      surfaceDesc: null,   // widget has no describeSurface override
      hash: null,          // host says "no hash"
    });
    reg.register({
      addr: { kind: 'widget', widgetId: 'x' },
      kindTag: 'generic', tier: 'vw',
    });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'x' } },
      { registry: reg, widgetHost: host },
    );
    expect(out.detail).toMatchObject({
      surfaceDescription: null,
      stateHash: null,
    });
  });

  test('Phase Z tier / zHint from registry override', () => {
    const reg = createSurfaceRegistry();
    const host = hostWithWR2({
      id: 'w', type: 'modal-widget', character: 'M', state: {},
      surfaceDesc: 'modal-band widget',
    });
    reg.register({
      addr: { kind: 'widget', widgetId: 'w' },
      kindTag: 'modal-widget', tier: 'modal', zHint: 5,
    });
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'w' } },
      { registry: reg, widgetHost: host },
    );
    expect(out.detail).toMatchObject({ zTier: 'modal', zIndex: 5 });
  });

  test('widget not in registry → zTier/zIndex null (no descriptor)', () => {
    const reg = createSurfaceRegistry();
    const host = hostWithWR2({
      id: 'orphan', type: 'stray', character: 'O', state: {},
      surfaceDesc: 'orphan widget',
    });
    // not registered
    const out = dispatchDescribeSurface(
      { addr: { kind: 'widget', widgetId: 'orphan' } },
      { registry: reg, widgetHost: host },
    );
    expect(out.found).toBe(true);
    expect(out.detail).toMatchObject({
      zTier: null,
      zIndex: null,
      // WR-2 still populated when host provides
      surfaceDescription: 'orphan widget',
    });
  });
});
