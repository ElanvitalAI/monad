// ── IUL-shared materializer pipeline tests — Bundle 4W P1 ──
//
// Covers the scenario-agnostic pipeline: catalog summary + generic
// system prompt + materialize() with prebuilt system/user strings.
// Parser + validator + catalog-check are already exercised via the
// iul-canvas wrapper suite; these cases pin the generic surface so
// Phase L MaterializeFromIntent + future scenario plugins can rely
// on stable behavior.

import { describe, test, expect } from 'bun:test';
import {
  buildCatalogSummary,
  buildGenericSystemPrompt,
  renderCatalogList,
  materialize,
  parseWidgetSpec,
  specTypeInCatalog,
  type CatalogEntry,
} from '../plugins/iul-shared/index.js';
import type { LLMProvider, LLMStreamEvent } from '../src/llm.js';

const SAMPLE_CATALOG: CatalogEntry[] = [
  { type: 'sparkline', description: 'compact value trend' },
  { type: 'chart-line', description: 'time-series line plot' },
  { type: 'table', description: 'tabular data' },
  { type: 'markdown', description: 'preformatted text' },
];

// ── buildCatalogSummary (scenario-agnostic) ─────────────

describe('buildCatalogSummary (iul-shared)', () => {
  test('returns every def when skipTypes is empty', () => {
    const defs = [
      { type: 'sparkline', description: 'spark' } as never,
      { type: 'table', description: 'tabular' } as never,
    ];
    const out = buildCatalogSummary(defs);
    expect(out.map((c) => c.type)).toEqual(['sparkline', 'table']);
  });

  test('filters every entry in skipTypes', () => {
    const defs = [
      { type: 'sparkline', description: 'spark' } as never,
      { type: 'iul-canvas', description: 'self' } as never,
      { type: 'iul-speech', description: 'also-self' } as never,
      { type: 'table', description: 'tabular' } as never,
    ];
    const out = buildCatalogSummary(defs, ['iul-canvas', 'iul-speech']);
    expect(out.map((c) => c.type)).toEqual(['sparkline', 'table']);
  });

  test('preserves order of input defs', () => {
    const defs = [
      { type: 'c', description: '' } as never,
      { type: 'a', description: '' } as never,
      { type: 'b', description: '' } as never,
    ];
    const out = buildCatalogSummary(defs);
    expect(out.map((c) => c.type)).toEqual(['c', 'a', 'b']);
  });
});

// ── renderCatalogList ──────────────────────────────────

describe('renderCatalogList', () => {
  test('renders each entry on its own line with description', () => {
    const rendered = renderCatalogList(SAMPLE_CATALOG);
    expect(rendered).toContain('- sparkline: compact value trend');
    expect(rendered).toContain('- table: tabular data');
  });

  test('falls back to placeholder for empty catalog', () => {
    expect(renderCatalogList([])).toContain('no widgets registered');
  });
});

// ── buildGenericSystemPrompt ───────────────────────────

describe('buildGenericSystemPrompt', () => {
  test('embeds the catalog list + intent source sentence', () => {
    const sp = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'a sketch on a canvas',
    });
    expect(sp).toContain('a sketch on a canvas');
    expect(sp).toContain('sparkline');
    expect(sp).toContain('compact value trend');
  });

  test('always asks for the strict JSON shape (widgetType / confidence / reason)', () => {
    const sp = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'anything',
    });
    expect(sp).toContain('widgetType');
    expect(sp).toContain('confidence');
    expect(sp).toContain('reason');
  });

  test('embeds scenario patterns block when provided', () => {
    const sp = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'x',
      patterns: 'SCENARIO-SPECIFIC-PATTERN-MARKER',
    });
    expect(sp).toContain('SCENARIO-SPECIFIC-PATTERN-MARKER');
  });

  test('appends extra rules when provided', () => {
    const sp = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'x',
      extraRules: 'EXTRA-RULE-MARKER',
    });
    expect(sp).toContain('EXTRA-RULE-MARKER');
  });

  test('byte-stable across two calls with the same opts (cache-friendly)', () => {
    const a = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'same',
      patterns: 'same',
    });
    const b = buildGenericSystemPrompt({
      catalog: SAMPLE_CATALOG,
      intentSource: 'same',
      patterns: 'same',
    });
    expect(a).toBe(b);
  });
});

// ── generic materialize() with mock provider ────────────

function mockProvider(response: string): LLMProvider {
  async function* streamChat(): AsyncGenerator<LLMStreamEvent, void, unknown> {
    yield { type: 'text', delta: response };
  }
  async function* chat(): AsyncGenerator<string, void, unknown> {
    yield response;
  }
  return {
    name: 'mock',
    defaultModel: 'mock-haiku',
    available: () => true,
    chat,
    streamChat,
  };
}

describe('materialize (iul-shared generic)', () => {
  test('returns parsed spec for a happy-path response', async () => {
    const provider = mockProvider(JSON.stringify({
      widgetType: 'sparkline',
      reason: 'trend detected',
      confidence: 0.82,
    }));
    const spec = await materialize({
      systemPrompt: 'any',
      userContent: 'intent: show a trend',
      catalog: SAMPLE_CATALOG,
      provider,
    });
    expect(spec.widgetType).toBe('sparkline');
    expect(spec.confidence).toBe(0.82);
  });

  test('rejects when LLM picks a widget type outside the catalog', async () => {
    const provider = mockProvider(JSON.stringify({
      widgetType: 'not-registered',
      reason: 'r',
      confidence: 0.9,
    }));
    await expect(materialize({
      systemPrompt: 'any',
      userContent: 'any',
      catalog: SAMPLE_CATALOG,
      provider,
    })).rejects.toThrow(/catalog/);
  });

  test('rejects on empty LLM response', async () => {
    const provider = mockProvider('');
    await expect(materialize({
      systemPrompt: 'any',
      userContent: 'any',
      catalog: SAMPLE_CATALOG,
      provider,
    })).rejects.toThrow(/empty/);
  });

  test('passes systemPrompt + userContent verbatim to provider messages', async () => {
    let captured: { role: string; content: string }[] | null = null;
    const provider: LLMProvider = {
      name: 'mock',
      defaultModel: 'mock-haiku',
      available: () => true,
      async *chat(messages) {
        captured = messages.map((m) => ({ role: m.role, content: m.content }));
        yield JSON.stringify({ widgetType: 'markdown', reason: 'r', confidence: 0.5 });
      },
    };
    await materialize({
      systemPrompt: 'SYS-MARKER',
      userContent: 'USR-MARKER',
      catalog: SAMPLE_CATALOG,
      provider,
    });
    expect(captured).not.toBeNull();
    expect(captured![0]).toEqual({ role: 'system', content: 'SYS-MARKER' });
    expect(captured![1]).toEqual({ role: 'user', content: 'USR-MARKER' });
  });
});

// ── re-export identity ──────────────────────────────────

describe('iul-shared pipeline primitives', () => {
  test('parseWidgetSpec + specTypeInCatalog importable from iul-shared', () => {
    const spec = parseWidgetSpec(JSON.stringify({
      widgetType: 'table',
      reason: 'tabular data suggested',
      confidence: 0.7,
    }));
    expect(spec.widgetType).toBe('table');
    expect(specTypeInCatalog(spec, SAMPLE_CATALOG)).toBe(true);
  });
});
