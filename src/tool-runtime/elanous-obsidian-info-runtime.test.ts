// PLAN-codex-app-server-hermes-parity §5 Phase H1·5c test —
// dispatchElanousObsidianInfo branches (available · unavailable · all
// source values). resolver override lets us assert the projection
// shape without touching real fs-roots state.

import { describe, test, expect } from 'bun:test';
import {
  dispatchElanousObsidianInfo,
  elanousObsidianInfoRuntime,
  buildElanousObsidianInfoTool,
} from './elanous-obsidian-info-runtime.js';

describe('dispatchElanousObsidianInfo · available', () => {
  test('returns root + source + summary when vault is available', () => {
    const r = dispatchElanousObsidianInfo({
      resolver: () => ({
        root: '/Users/test/Obsidian/MyVault',
        available: true,
        source: 'config',
      }),
    });
    expect(r.available).toBe(true);
    expect(r.root).toBe('/Users/test/Obsidian/MyVault');
    expect(r.source).toBe('config');
    expect(r.output).toContain('vault available');
    expect(r.output).toContain('/Users/test/Obsidian/MyVault');
    expect(r.output).toContain('source=config');
  });

  test.each([
    'config',
    'env',
    'backup',
    'default',
    'discovery',
  ])('passes through source=%s when available', (source) => {
    const r = dispatchElanousObsidianInfo({
      resolver: () => ({ root: '/x', available: true, source }),
    });
    expect(r.source).toBe(source);
  });
});

describe('dispatchElanousObsidianInfo · unavailable', () => {
  test('returns available: false + source: none without root', () => {
    const r = dispatchElanousObsidianInfo({
      resolver: () => ({ root: '', available: false, source: 'none' }),
    });
    expect(r.available).toBe(false);
    expect(r.root).toBeUndefined();
    expect(r.source).toBe('none');
    expect(r.output).toContain('vault unavailable');
    expect(r.output).toContain('source=none');
  });
});

describe('elanousObsidianInfoRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(elanousObsidianInfoRuntime.id).toBe('elanous_obsidian_info');
    expect(elanousObsidianInfoRuntime.spec.name).toBe('elanous_obsidian_info');
  });

  test('buildElanousObsidianInfoTool returns no-arg LLMToolSpec', () => {
    const spec = buildElanousObsidianInfoTool();
    expect(spec.name).toBe('elanous_obsidian_info');
    const params = spec.parameters as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(params.type).toBe('object');
    expect(Object.keys(params.properties ?? {})).toEqual([]);
  });

  test('runtime.run uses default resolver (real fs-roots)', async () => {
    // Default resolver may or may not find a vault on the test host;
    // just assert the shape matches one of the two branches.
    const r = await elanousObsidianInfoRuntime.run({}, { surface: 'mcp' });
    expect(typeof r.available).toBe('boolean');
    expect(typeof r.source).toBe('string');
    if (r.available) {
      expect(typeof r.root).toBe('string');
    }
  });
});
