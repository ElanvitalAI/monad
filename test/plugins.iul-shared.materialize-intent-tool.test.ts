// ── MaterializeFromIntent LLM tool tests — Bundle 4W P2 ──
//
// Covers: tool spec shape · args validation · provider gate · catalog
// resolution (defaultSkipTypes + whitelist filter) · dispatch happy
// path (spawn + dryRun) · error propagation. Uses a mock LLMProvider
// + mock widget-host so no external deps.

import { describe, test, expect } from 'bun:test';
import {
  buildMaterializeFromIntentTool,
  dispatchMaterializeFromIntent,
  type MaterializeIntentDeps,
} from '../plugins/iul-shared/materialize-intent-tool.js';
import type { LLMProvider, LLMStreamEvent } from '../src/llm.js';
import type { WidgetInstance, WidgetTypeInfo } from '../src/widgets/types.js';
import {
  createMaterializeFromIntentRuntime,
  registerMaterializeRuntimes,
  __resetMaterializeRuntimesForTest,
} from '../src/tool-runtime/materialize-runtimes.js';

// ── Mock helpers ────────────────────────────────────────

function mockProvider(response: string, available = true): LLMProvider {
  async function* streamChat(): AsyncGenerator<LLMStreamEvent, void, unknown> {
    yield { type: 'text', delta: response };
  }
  async function* chat(): AsyncGenerator<string, void, unknown> {
    yield response;
  }
  return {
    name: 'mock',
    defaultModel: 'mock-haiku',
    available: () => available,
    chat,
    streamChat,
  };
}

const SAMPLE_TYPES: WidgetTypeInfo[] = [
  { type: 'sparkline', description: 'compact value trend', source: 'builtin' },
  { type: 'chart-line', description: 'time-series line plot', source: 'builtin' },
  { type: 'table', description: 'tabular data', source: 'builtin' },
  { type: 'markdown', description: 'preformatted text', source: 'builtin' },
  { type: 'iul-canvas', description: 'self', source: 'plugin' },
];

function mockInstance(id: string, type: string): WidgetInstance {
  return { id, type, character: `c-${id}`, state: {} };
}

function mockDeps(opts: {
  providerResponse?: string;
  providerAvailable?: boolean;
  types?: readonly WidgetTypeInfo[];
  spawn?: MaterializeIntentDeps['spawnWidget'];
  defaultSkipTypes?: readonly string[];
}): MaterializeIntentDeps {
  const response = opts.providerResponse ?? JSON.stringify({
    widgetType: 'sparkline', reason: 'trend detected', confidence: 0.82,
  });
  return {
    getProvider: () => mockProvider(response, opts.providerAvailable ?? true),
    listWidgetTypes: () => opts.types ?? SAMPLE_TYPES,
    ...(opts.spawn !== undefined ? { spawnWidget: opts.spawn } : {}),
    ...(opts.defaultSkipTypes !== undefined
      ? { defaultSkipTypes: opts.defaultSkipTypes }
      : {}),
  };
}

// ── Tool spec shape ────────────────────────────────────

describe('buildMaterializeFromIntentTool', () => {
  test('has the expected name + required parameter', () => {
    const spec = buildMaterializeFromIntentTool();
    expect(spec.name).toBe('MaterializeFromIntent');
    expect(spec.description.length).toBeGreaterThan(20);
    expect(spec.parameters).toBeDefined();
    const params = spec.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['intent']);
    expect(params.properties.intent).toBeDefined();
    expect(params.properties.catalog).toBeDefined();
    expect(params.properties.dryRun).toBeDefined();
  });
});

// ── Args validation ────────────────────────────────────

describe('dispatchMaterializeFromIntent — args validation', () => {
  test('rejects missing intent', async () => {
    await expect(
      dispatchMaterializeFromIntent({}, mockDeps({})),
    ).rejects.toThrow(/intent is required/);
  });

  test('rejects empty intent', async () => {
    await expect(
      dispatchMaterializeFromIntent({ intent: '   ' }, mockDeps({})),
    ).rejects.toThrow(/intent is required/);
  });

  test('rejects non-string intent', async () => {
    await expect(
      dispatchMaterializeFromIntent({ intent: 42 }, mockDeps({})),
    ).rejects.toThrow(/intent is required/);
  });
});

// ── Provider gate ──────────────────────────────────────

describe('dispatchMaterializeFromIntent — provider gate', () => {
  test('throws when provider.available() is false', async () => {
    await expect(
      dispatchMaterializeFromIntent(
        { intent: 'show me a heap gauge' },
        mockDeps({ providerAvailable: false }),
      ),
    ).rejects.toThrow(/not available/);
  });
});

// ── Catalog resolution ─────────────────────────────────

describe('dispatchMaterializeFromIntent — catalog', () => {
  test('defaultSkipTypes excludes iul-canvas from catalog', async () => {
    // If iul-canvas ever reached the LLM prompt, the LLM could pick
    // it. The dispatcher must filter it out before materialize().
    // We assert by making the LLM return iul-canvas and expecting a
    // catalog-mismatch error.
    const deps = mockDeps({
      providerResponse: JSON.stringify({
        widgetType: 'iul-canvas',
        reason: 'self-spawn',
        confidence: 0.9,
      }),
      defaultSkipTypes: ['iul-canvas'],
    });
    await expect(
      dispatchMaterializeFromIntent({ intent: 'anything' }, deps),
    ).rejects.toThrow(/catalog/);
  });

  test('throws when filter reduces catalog to empty', async () => {
    await expect(
      dispatchMaterializeFromIntent(
        { intent: 'x', catalog: ['not-registered'] },
        mockDeps({}),
      ),
    ).rejects.toThrow(/catalog is empty/);
  });

  test('applies catalog whitelist', async () => {
    // LLM returns sparkline, which is OK both unfiltered and when
    // whitelist includes sparkline.
    const deps = mockDeps({});
    const out = await dispatchMaterializeFromIntent(
      { intent: 'trend', catalog: ['sparkline', 'chart-line'], dryRun: true },
      deps,
    );
    expect(out.widgetType).toBe('sparkline');
  });
});

// ── Dispatch happy paths ───────────────────────────────

describe('dispatchMaterializeFromIntent — spawn', () => {
  test('spawns widget by default and returns widgetId', async () => {
    let spawnedOpts: { type: string } | null = null;
    const deps = mockDeps({
      spawn: (opts) => {
        spawnedOpts = opts;
        return mockInstance('spark-1', opts.type);
      },
    });
    const out = await dispatchMaterializeFromIntent(
      { intent: 'show trend' },
      deps,
    );
    expect(out.spawned).toBe(true);
    expect(out.widgetId).toBe('spark-1');
    expect(out.widgetType).toBe('sparkline');
    expect(out.confidence).toBe(0.82);
    expect(spawnedOpts).not.toBeNull();
    expect(spawnedOpts!.type).toBe('sparkline');
  });

  test('dryRun:true skips spawn', async () => {
    let spawnCalled = false;
    const deps = mockDeps({
      spawn: () => {
        spawnCalled = true;
        return mockInstance('x', 'sparkline');
      },
    });
    const out = await dispatchMaterializeFromIntent(
      { intent: 'preview', dryRun: true },
      deps,
    );
    expect(out.spawned).toBe(false);
    expect(out.widgetId).toBeUndefined();
    expect(spawnCalled).toBe(false);
    // Spec fields still present
    expect(out.widgetType).toBe('sparkline');
    expect(out.reason).toBe('trend detected');
  });

  test('no spawnWidget dep → returns spec only, spawned:false', async () => {
    const deps = mockDeps({}); // spawnWidget absent
    const out = await dispatchMaterializeFromIntent(
      { intent: 'x' },
      deps,
    );
    expect(out.spawned).toBe(false);
    expect(out.widgetId).toBeUndefined();
    expect(out.widgetType).toBe('sparkline');
  });

  test('spawn throw is wrapped in a MaterializeFromIntent error', async () => {
    const deps = mockDeps({
      spawn: () => { throw new Error('underlying registry error'); },
    });
    await expect(
      dispatchMaterializeFromIntent({ intent: 'x' }, deps),
    ).rejects.toThrow(/spawnWidget.*failed.*underlying registry error/);
  });
});

// ── Runtime wrapper ────────────────────────────────────

describe('createMaterializeFromIntentRuntime', () => {
  test('run() returns JSON-stringified output', async () => {
    const deps = mockDeps({
      spawn: (opts) => mockInstance('spark-1', opts.type),
    });
    const rt = createMaterializeFromIntentRuntime(deps);
    expect(rt.id).toBe('iul_materialize_from_intent');
    expect(rt.spec.name).toBe('MaterializeFromIntent');
    const out = await rt.run({ intent: 'trend' });
    const parsed = JSON.parse(out.output);
    expect(parsed.widgetType).toBe('sparkline');
    expect(parsed.spawned).toBe(true);
  });
});

// ── Registration idempotence ───────────────────────────

describe('registerMaterializeRuntimes', () => {
  test('first call registers; second with same deps is a no-op', () => {
    __resetMaterializeRuntimesForTest();
    const deps = mockDeps({});
    expect(() => registerMaterializeRuntimes(deps)).not.toThrow();
    expect(() => registerMaterializeRuntimes(deps)).not.toThrow();
    __resetMaterializeRuntimesForTest();
  });

  test('different deps after register → throws until reset', () => {
    __resetMaterializeRuntimesForTest();
    const a = mockDeps({});
    const b = mockDeps({});
    registerMaterializeRuntimes(a);
    expect(() => registerMaterializeRuntimes(b)).toThrow(/different deps/);
    __resetMaterializeRuntimesForTest();
    // After reset, fresh registration works
    expect(() => registerMaterializeRuntimes(b)).not.toThrow();
    __resetMaterializeRuntimesForTest();
  });
});
