// ── Presentation P5a · integration · real YAML files ──
//
// Verifies the repo's scenarios/ directory actually loads cleanly and
// materializes. Acts as a smoke test against the canonical examples
// checked in under scenarios/*.yaml.

import { describe, test, expect } from 'bun:test';
import { join } from 'path';
import { loadScenarioCatalog } from '../../src/scenarios/catalog.js';
import { materializeScenario } from '../../src/scenarios/materialize.js';
import { BoxDecoration } from '../../src/ui/attributes/index.js';

const SCENARIOS_DIR = join(__dirname, '..', '..', 'scenarios');

describe('scenarios/ directory · checked-in examples', () => {
  test('catalog loads all 3 example scenarios without errors', async () => {
    const cat = await loadScenarioCatalog(SCENARIOS_DIR);
    expect(cat.errors).toEqual([]);
    expect(cat.scenarios.size).toBeGreaterThanOrEqual(3);
    expect(cat.scenarios.has('dashboard-default')).toBe(true);
    expect(cat.scenarios.has('heap-graph')).toBe(true);
    expect(cat.scenarios.has('iul-timeline-viewer')).toBe(true);
  });

  test('dashboard-default · materializes into 2 widgets with decorations', async () => {
    const cat = await loadScenarioCatalog(SCENARIOS_DIR);
    const def = cat.scenarios.get('dashboard-default');
    expect(def).toBeDefined();
    // Use lax mode · unknown widget types (list/log registered elsewhere)
    // should fall back gracefully in integration context.
    const result = materializeScenario(def!, { lax: true });
    expect(result.widgets).toHaveLength(2);
    const [log, list] = result.widgets;
    expect(log?.type).toBe('log');
    expect(list?.type).toBe('list');
    // Shorthand border.all expanded → BoxDecoration.border has top set
    expect(log?.decoration).toBeInstanceOf(BoxDecoration);
    expect(log?.decoration?.border?.top?.color).toBe('border');
    expect(log?.decoration?.borderRadius?.topLeft).toBe(1);
    // padding: 1 (scalar) → EdgeInsets.all(1)
    expect(log?.decoration?.padding?.horizontal).toBe(2);
    // list has boxShadow list
    expect(list?.decoration?.boxShadow).toHaveLength(1);
  });

  test('iul-timeline-viewer · double border style round-trips', async () => {
    const cat = await loadScenarioCatalog(SCENARIOS_DIR);
    const def = cat.scenarios.get('iul-timeline-viewer');
    const result = materializeScenario(def!, { lax: true });
    const viewer = result.widgets.find((w) => w.id === 'iul-viewer');
    expect(viewer?.decoration?.border?.top?.style).toBe('double');
  });

  test('heap-graph · symmetric border + padding scalar → EdgeInsets.all', async () => {
    const cat = await loadScenarioCatalog(SCENARIOS_DIR);
    const def = cat.scenarios.get('heap-graph');
    const result = materializeScenario(def!, { lax: true });
    const summary = result.widgets[0];
    expect(summary?.type).toBe('hello-text');
    // horizontal: border.accent · vertical: border
    expect(summary?.decoration?.border?.left?.color).toBe('border.accent');
    expect(summary?.decoration?.border?.top?.color).toBe('border');
    // padding: 2 scalar → EdgeInsets.all(2)
    expect(summary?.decoration?.padding?.top).toBe(2);
    expect(summary?.decoration?.padding?.bottom).toBe(2);
    expect(summary?.decoration?.padding?.left).toBe(2);
    expect(summary?.decoration?.padding?.right).toBe(2);
  });
});
