import { beforeEach, describe, expect, test } from 'bun:test';
import { registerAllDefaultToolRuntimes } from './index.js';
import {
  _resetToolRuntimeRegistryForTest,
  dispatchToolByName,
  listToolRuntimes,
} from './registry.js';
import { SELF_COGNITION_TOOL_NAMES } from './self-cognition-runtimes.js';

describe('self-cognition runtime registry wiring', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    registerAllDefaultToolRuntimes();
  });

  test('lists every ledger entry for MCP', () => {
    const mcpNames = new Set(listToolRuntimes('mcp').map(runtime => runtime.id));
    for (const name of SELF_COGNITION_TOOL_NAMES) expect(mcpNames).toContain(name);
  });

  test('keeps browser runtimes out of the MCP proxy registry', () => {
    const mcpNames = new Set(listToolRuntimes('mcp').map(runtime => runtime.id));

    expect(mcpNames.has('browser_navigate')).toBe(false);
    expect(mcpNames.has('browser_read')).toBe(false);
    expect(mcpNames.has('browser_open')).toBe(false);
    expect(mcpNames.has('browser_screenshot')).toBe(false);
    expect(mcpNames.has('browser_close')).toBe(false);
  });

  test('dispatches a listed self-cognition tool through the registry', async () => {
    const result = await dispatchToolByName('memory_recall', {}, { surface: 'mcp' });
    expect(result).toEqual(expect.any(Object));
    expect('hits' in result || 'error' in result).toBe(true);
  });
});
