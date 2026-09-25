// ── PFC-S5 P6: ToolRuntime registration ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ALL_INTELLIGENCE_MAP_RUNTIMES,
  intelligenceMapRuntime,
  routeToModelRuntime,
} from '../src/tool-runtime/intelligence-map-runtimes';
import {
  registerToolRuntime,
  getToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';

describe('PFC-S5 P6 — intelligence-map ToolRuntime registration', () => {
  beforeEach(() => { _resetToolRuntimeRegistryForTest(); });

  test('ALL_INTELLIGENCE_MAP_RUNTIMES has 2 unique ids', () => {
    expect(ALL_INTELLIGENCE_MAP_RUNTIMES.length).toBe(2);
    const ids = ALL_INTELLIGENCE_MAP_RUNTIMES.map(rt => rt.id);
    expect(ids).toEqual(['intelligence_map', 'route_to_model']);
  });

  test('each runtime exposes matching tool spec name', () => {
    expect(intelligenceMapRuntime.spec.name).toBe('IntelligenceMap');
    expect(routeToModelRuntime.spec.name).toBe('RouteToModel');
  });

  test('registration idempotent', () => {
    for (const rt of ALL_INTELLIGENCE_MAP_RUNTIMES) registerToolRuntime(rt);
    for (const rt of ALL_INTELLIGENCE_MAP_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('intelligence_map')).toBeDefined();
    expect(getToolRuntime('route_to_model')).toBeDefined();
  });

  test('dispatchToolByName intelligence_map returns snapshot', async () => {
    for (const rt of ALL_INTELLIGENCE_MAP_RUNTIMES) registerToolRuntime(rt);
    const r = await dispatchToolByName('intelligence_map', {}, { surface: 'skill' });
    expect((r as any).catalog_summary).toBeDefined();
    expect((r as any).system).toBeDefined();
  });

  test('dispatchToolByName route_to_model throws on missing task_type', async () => {
    for (const rt of ALL_INTELLIGENCE_MAP_RUNTIMES) registerToolRuntime(rt);
    await expect(
      dispatchToolByName('route_to_model', {}, { surface: 'skill' }),
    ).rejects.toThrow(/task_type is required/);
  });
});
