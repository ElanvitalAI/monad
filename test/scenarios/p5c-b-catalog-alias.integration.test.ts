// ── Presentation P5c-b · native-tool-catalog alias dispatch ──
//
// Proves that registering the 4 scenario runtimes + having catalog
// entries (PR adding `ui_list_scenarios` / `ui_run_scenario` /
// `ui_get_scenario_schema` / `ui_validate_scenario_yaml` to
// nativeToolCatalog) makes the tools dispatchable by PascalCase LLM
// alias and visible in `listToolRuntimes('mcp')`.
//
// Before this PR only canonical-id dispatch worked; the LLM's
// natural tool-use name (`RunScenario`) raised "No ToolRuntime
// registered" in the main chat loop. Integration tests guard
// against the aliases regressing.

import { describe, test, expect, beforeEach } from 'bun:test';
import type { ScenarioCatalog, ScenarioDef } from '../../src/scenarios/types.js';
import { findNativeTool } from '../../src/native-tool-catalog.js';
import {
  registerScenarioRuntimes,
  __resetScenarioRuntimesForTest,
} from '../../src/tool-runtime/scenario-runtimes.js';
import {
  dispatchToolByName,
  getToolRuntime,
  listToolRuntimes,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';

const CTX = { surface: 'dashboard' as const };

const HELLO: ScenarioDef = {
  id: 'hello',
  title: 'Hello',
  layout: { widget: 'log', config: { lines: ['hi'] } },
};

function makeCatalog(defs: ScenarioDef[]): ScenarioCatalog {
  const scenarios = new Map<string, ScenarioDef>();
  for (const d of defs) scenarios.set(d.id, d);
  return { scenarios, errors: [] };
}

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetScenarioRuntimesForTest();
});

describe('P5c-b · catalog alias dispatch', () => {
  test('each scenario id resolves a catalog entry with PascalCase alias + canonical id', () => {
    const cases: Array<[string, string]> = [
      ['ui_list_scenarios', 'ListScenarios'],
      ['ui_run_scenario', 'RunScenario'],
      ['ui_get_scenario_schema', 'GetScenarioSchema'],
      ['ui_validate_scenario_yaml', 'ValidateScenarioYaml'],
    ];
    for (const [id, alias] of cases) {
      const byId = findNativeTool(id);
      const byAlias = findNativeTool(alias);
      expect(byId?.id).toBe(id);
      expect(byAlias?.id).toBe(id);
      expect(byId?.aliases).toContain(alias);
    }
  });

  test('getToolRuntime resolves PascalCase alias after registerScenarioRuntimes', () => {
    registerScenarioRuntimes({ getCatalog: () => makeCatalog([HELLO]) });
    expect(getToolRuntime('RunScenario')?.id).toBe('ui_run_scenario');
    expect(getToolRuntime('ListScenarios')?.id).toBe('ui_list_scenarios');
    expect(getToolRuntime('GetScenarioSchema')?.id).toBe('ui_get_scenario_schema');
    expect(getToolRuntime('ValidateScenarioYaml')?.id).toBe('ui_validate_scenario_yaml');
  });

  test('dispatchToolByName("RunScenario") reaches the runtime via alias', async () => {
    let mountedCount = 0;
    registerScenarioRuntimes({
      getCatalog: () => makeCatalog([HELLO]),
      onMount: (widgets) => { mountedCount = widgets.length; },
    });
    const res = await dispatchToolByName('RunScenario', { id: 'hello' }, CTX);
    const payload = JSON.parse((res as { output: string }).output);
    expect(payload.ok).toBe(true);
    expect(payload.mounted).toBe(true);
    expect(mountedCount).toBe(1);
  });

  test('dispatchToolByName by PascalCase matches dispatch by canonical id', async () => {
    registerScenarioRuntimes({ getCatalog: () => makeCatalog([HELLO]) });
    const byAlias = await dispatchToolByName('ListScenarios', {}, CTX);
    const byId = await dispatchToolByName('ui_list_scenarios', {}, CTX);
    expect((byAlias as { output: string }).output)
      .toEqual((byId as { output: string }).output);
  });

  test('listToolRuntimes("mcp") includes all 4 scenario tools once registered', () => {
    registerScenarioRuntimes({ getCatalog: () => makeCatalog([]) });
    const mcpTools = listToolRuntimes('mcp').map((rt) => rt.id);
    expect(mcpTools).toContain('ui_list_scenarios');
    expect(mcpTools).toContain('ui_run_scenario');
    expect(mcpTools).toContain('ui_get_scenario_schema');
    expect(mcpTools).toContain('ui_validate_scenario_yaml');
  });

  test('listToolRuntimes respects the registered runtime set (scenarios absent until register)', () => {
    // No registerScenarioRuntimes call — the catalog has the entries
    // but the runtime registry is empty, so surface filtering still
    // returns them at zero from listToolRuntimes (filter iterates
    // runtimes, not catalog).
    expect(listToolRuntimes('mcp').map((rt) => rt.id)).not.toContain('ui_run_scenario');
    registerScenarioRuntimes({ getCatalog: () => makeCatalog([]) });
    expect(listToolRuntimes('mcp').map((rt) => rt.id)).toContain('ui_run_scenario');
  });

  test('ValidateScenarioYaml via alias still needs no catalog', async () => {
    registerScenarioRuntimes({ getCatalog: () => undefined });
    const yaml = 'id: inline\ntitle: inline\nlayout:\n  - widget: log\n    config: {}\n';
    const res = await dispatchToolByName('ValidateScenarioYaml', { yaml }, CTX);
    const payload = JSON.parse((res as { output: string }).output);
    expect(payload.ok).toBe(true);
    expect(payload.widgetCount).toBe(1);
  });
});
