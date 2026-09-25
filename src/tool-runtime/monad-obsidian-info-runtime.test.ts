// PLAN-codex-app-server-hermes-parity §5 Phase H1·5c test —
// dispatchMonadObsidianInfo branches (available · unavailable · all
// source values). resolver override lets us assert the projection
// shape without touching real fs-roots state.

import { describe, test, expect } from 'bun:test';
import {
  dispatchMonadObsidianInfo,
  monadObsidianInfoRuntime,
  buildMonadObsidianInfoTool,
} from './monad-obsidian-info-runtime.js';

describe('dispatchMonadObsidianInfo · available', () => {
  test('returns root + source + summary when vault is available', () => {
    const r = dispatchMonadObsidianInfo({
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
    const r = dispatchMonadObsidianInfo({
      resolver: () => ({ root: '/x', available: true, source }),
    });
    expect(r.source).toBe(source);
  });
});

describe('dispatchMonadObsidianInfo · unavailable', () => {
  test('returns available: false + source: none without root', () => {
    const r = dispatchMonadObsidianInfo({
      resolver: () => ({ root: '', available: false, source: 'none' }),
    });
    expect(r.available).toBe(false);
    expect(r.root).toBeUndefined();
    expect(r.source).toBe('none');
    expect(r.output).toContain('vault unavailable');
    expect(r.output).toContain('source=none');
  });
});

describe('monadObsidianInfoRuntime · ToolRuntime interface', () => {
  test('exposes id and spec', () => {
    expect(monadObsidianInfoRuntime.id).toBe('monad_obsidian_info');
    expect(monadObsidianInfoRuntime.spec.name).toBe('monad_obsidian_info');
  });

  test('buildMonadObsidianInfoTool returns no-arg LLMToolSpec', () => {
    const spec = buildMonadObsidianInfoTool();
    expect(spec.name).toBe('monad_obsidian_info');
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
    const r = await monadObsidianInfoRuntime.run({}, { surface: 'mcp' });
    expect(typeof r.available).toBe('boolean');
    expect(typeof r.source).toBe('string');
    if (r.available) {
      expect(typeof r.root).toBe('string');
    }
  });
});
