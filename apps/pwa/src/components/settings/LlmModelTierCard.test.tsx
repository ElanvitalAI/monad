// M2-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Mount surface contract for the LLM tier slider card.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaemonProvider } from '@/components/providers/DaemonProvider';
import { LlmModelTierCard } from './LlmModelTierCard';

function render(): string {
  return renderToStaticMarkup(
    <DaemonProvider>
      <LlmModelTierCard />
    </DaemonProvider>,
  );
}

describe('M2-1 · LlmModelTierCard · mount surface', () => {
  test('exports a component', () => {
    expect(typeof LlmModelTierCard).toBe('function');
  });

  test('SSR renders without throwing', () => {
    const html = render();
    expect(html).toContain('llm-model-tier-card');
    expect(html).toContain('llm-model-tier-slider');
    expect(html).toContain('llm-model-tier-rationale');
    expect(html).toContain('llm-model-tier-tick-labels');
    expect(html).toContain('llm-model-tier-reset');
  });

  test('default rendering = Balanced + Smart default badge', () => {
    const html = render();
    expect(html).toContain('Balanced');
    expect(html).toContain('llm-model-tier-default-badge');
    expect(html).toContain('Smart default');
  });

  test('default slider position is rank 1 (balanced)', () => {
    const html = render();
    expect(html).toContain('value="1"');
    expect(html).toContain('aria-valuenow="1"');
  });

  test('all 5 tier labels rendered in tick row', () => {
    const html = render();
    for (const label of ['Budget', 'Balanced', 'Better', 'Best', 'Loaded']) {
      expect(html).toContain(label);
    }
  });

  test('default provider (anthropic) surfaces in badge', () => {
    const html = render();
    // DaemonProvider initialises with EMPTY_CONFIG · provider="" · the
    // card's resolveProvider falls back to anthropic.
    expect(html).toContain('Anthropic');
  });

  test('default model id (claude-haiku-4-5) rendered for anthropic balanced', () => {
    const html = render();
    expect(html).toContain('claude-haiku-4-5');
  });

  test('slider a11y attributes', () => {
    const html = render();
    expect(html).toContain('aria-label="AI assistant tier"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuetext="Balanced"');
  });

  test('reset button shows default tier label', () => {
    const html = render();
    expect(html).toContain('Reset to default (Balanced)');
  });
});
