// ── PFC-S5 P4: RouteToModel LLM tool ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchRouteToModel,
  buildRouteToModelTool,
} from '../src/intelligence-map/tools/route-to-model';

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'route-tool-'));
}

describe('PFC-S5 P4 — RouteToModel tool', () => {
  test('dispatch returns recommendation for reasoning task', async () => {
    const home = scratchHome();
    const rec = await dispatchRouteToModel(
      { task_type: 'reasoning' },
      { home, env: { ANTHROPIC_API_KEY: 'x', GROK_API_KEY: 'y' } },
    );
    expect(rec.recommended).toBeDefined();
    expect(rec.diagnostics).toBeDefined();
    expect(rec.reasoning.length).toBeGreaterThan(10);
  });

  test('missing task_type throws', async () => {
    const home = scratchHome();
    await expect(
      dispatchRouteToModel({} as any, { home }),
    ).rejects.toThrow(/task_type is required/);
  });

  test('force_local propagates through dispatch', async () => {
    const home = scratchHome();
    const rec = await dispatchRouteToModel(
      { task_type: 'coding', force_local: true },
      { home, env: { ANTHROPIC_API_KEY: 'x' } },
    );
    if (rec.recommended) {
      // Should be a local model (qwen coder fits coding + local)
      expect(['qwen2.5-coder:32b', 'llama3:70b']).toContain(rec.recommended);
    } else {
      // Or RAM-gated out in CI environments with < 24GB free RAM.
      expect(rec.diagnostics.ram).toBeDefined();
    }
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildRouteToModelTool();
    expect(spec.name).toBe('RouteToModel');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['task_type']);
    const props = params.properties as Record<string, any>;
    expect(props.task_type.enum).toContain('reasoning');
    expect(props.task_type.enum).toContain('local_preferred');
  });
});
