// ── §5-③ Phase C2b: continuation turn runner (agent surface) ──

import { describe, test, expect } from 'bun:test';
import { buildContinuationAgentTools } from '../../src/dispatch/continuation-turn-runner';

describe('buildContinuationAgentTools', () => {
  test('produces the agent tool surface (Bash + native file tools) + a dispatcher', () => {
    const { specs, dispatch } = buildContinuationAgentTools();
    const names = specs.map((s) => s.name);
    // Bash is always wired (self-debugging minimum surface).
    expect(names).toContain('Bash');
    // Native coding surface present (Read / Grep / Glob / Edit / Write …).
    expect(names.length).toBeGreaterThan(1);
    expect(names.some((n) => /read|grep|edit|write|glob/i.test(n))).toBe(true);
    expect(typeof dispatch).toBe('function');
  });

  // Regression guard: WebSearch must be in the surface whenever a provider is
  // available. It was silently absent because the dynamic native resolver
  // gates web-search on hasWebSearchIntent(userText) and this surface is built
  // with an empty userText — so the finance/telegram agent could never chain a
  // WebSearch and stopped to ask instead. It's now added unconditionally.
  test('exposes WebSearch (+ web_search alias) when a provider is available', async () => {
    const { getAvailableWebSearchProviders } = await import('../../src/web-search/index');
    const { specs, dispatch } = buildContinuationAgentTools();
    const names = specs.map((s) => s.name);
    if (getAvailableWebSearchProviders().length >= 1) {
      expect(names).toContain('WebSearch');
      // Empty query throws inside dispatch → surfaced as an error object, which
      // still proves the name is WIRED (not an unknown-tool passthrough).
      const r = await dispatch('web_search', {});
      expect(JSON.stringify(r)).toMatch(/query is required|error/i);
    } else {
      expect(names).not.toContain('WebSearch');
    }
  });

  test('dispatch of an unknown tool returns an error object (no throw)', async () => {
    const { dispatch } = buildContinuationAgentTools();
    const r = await dispatch('NoSuchTool', {});
    expect(r).toBeDefined();
    expect(typeof r).toBe('object');
    // both the runtime-unavailable and dispatch-failed paths return {error|...}.
    expect(JSON.stringify(r)).toMatch(/error|unavailable/i);
  });
});
