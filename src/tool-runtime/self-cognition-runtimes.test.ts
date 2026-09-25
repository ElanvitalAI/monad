import { describe, expect, test } from 'bun:test';
import { CORE_TOOL_SPECS } from '../domains/core-tools.js';
import {
  SELF_COGNITION_MCP_CATALOG_ENTRIES,
  SELF_COGNITION_RUNTIMES,
  SELF_COGNITION_TOOL_NAMES,
} from './self-cognition-runtimes.js';

describe('self-cognition runtimes', () => {
  test('derives runtime specs and MCP metadata from the authoritative name ledger', () => {
    expect(SELF_COGNITION_RUNTIMES.map(runtime => runtime.id)).toEqual([...SELF_COGNITION_TOOL_NAMES]);
    expect(SELF_COGNITION_MCP_CATALOG_ENTRIES.map(entry => entry.id)).toEqual([...SELF_COGNITION_TOOL_NAMES]);
    expect(SELF_COGNITION_RUNTIMES.map(runtime => runtime.spec.name)).toEqual([...SELF_COGNITION_TOOL_NAMES]);
    expect(SELF_COGNITION_TOOL_NAMES.every(name => CORE_TOOL_SPECS.some(spec => spec.name === name))).toBe(true);
  });

  test('exposes only read-only parallel-safe MCP entries', () => {
    for (const entry of SELF_COGNITION_MCP_CATALOG_ENTRIES) {
      expect(entry.host).toEqual(['mcp']);
      expect(entry.safety).toEqual(['read-only']);
      expect(entry.supportsParallel).toBe(true);
    }
  });
});
