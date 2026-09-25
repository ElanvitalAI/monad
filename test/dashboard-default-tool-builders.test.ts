// Step 2 next-stone — default dashboard tool builders factory tests.
// Verifies the closures lazy-load the actual tool implementations
// without crashing at construct time and that the returned shape
// matches what `buildDashboardOptionalToolSpecs` consumes.

import { describe, expect, it } from 'bun:test';
import { buildDefaultDashboardToolBuilders } from '../src/dashboard/input/dashboard-default-tool-builders';

describe('buildDefaultDashboardToolBuilders', () => {
  it('returns object with all 6 optional-tool builder closures', () => {
    const b = buildDefaultDashboardToolBuilders();
    expect(typeof b.buildBashTool).toBe('function');
    expect(typeof b.buildTerminalInjectTool).toBe('function');
    expect(typeof b.buildApiCallTool).toBe('function');
    expect(typeof b.buildRunShellTool).toBe('function');
    expect(typeof b.buildDashboardStateTool).toBe('function');
    expect(typeof b.buildTerminalModalTools).toBe('function');
  });

  it('construct is cheap — no requires until a builder is invoked', () => {
    // If constructing the factory triggered all 7 module loads we'd
    // pay 50-150ms; this test verifies the factory itself is sub-ms.
    const startedAt = performance.now();
    for (let i = 0; i < 100; i++) buildDefaultDashboardToolBuilders();
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeLessThan(50);
  });

  it('buildBashTool returns a tool spec with name', () => {
    const b = buildDefaultDashboardToolBuilders();
    const spec = b.buildBashTool();
    expect(spec).toBeDefined();
    expect(typeof spec.name).toBe('string');
    expect(spec.name.length).toBeGreaterThan(0);
  });

  it('buildTerminalModalTools returns an array', () => {
    const b = buildDefaultDashboardToolBuilders();
    const specs = b.buildTerminalModalTools();
    expect(Array.isArray(specs)).toBe(true);
    expect(specs.length).toBeGreaterThan(0);
  });
});
