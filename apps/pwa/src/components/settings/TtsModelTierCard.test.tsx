// M2-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Mount surface contract for TTS tier slider card.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaemonProvider } from '@/components/providers/DaemonProvider';
import { TtsModelTierCard } from './TtsModelTierCard';

function render(): string {
  return renderToStaticMarkup(
    <DaemonProvider>
      <TtsModelTierCard />
    </DaemonProvider>,
  );
}

describe('M2-2 · TtsModelTierCard · mount surface', () => {
  test('exports a component', () => {
    expect(typeof TtsModelTierCard).toBe('function');
  });

  test('SSR renders without throwing', () => {
    const html = render();
    expect(html).toContain('tts-model-tier-card');
    expect(html).toContain('tts-model-tier-slider');
    expect(html).toContain('tts-model-tier-rationale');
    expect(html).toContain('tts-model-tier-tick-labels');
    expect(html).toContain('tts-model-tier-reset');
  });

  test('default rendering = Balanced + Smart default badge', () => {
    const html = render();
    expect(html).toContain('Balanced');
    expect(html).toContain('tts-model-tier-default-badge');
    expect(html).toContain('Smart default');
  });

  test('default slider position is rank 1 (balanced)', () => {
    const html = render();
    expect(html).toContain('value="1"');
    expect(html).toContain('aria-valuenow="1"');
  });

  test('all 5 tier labels rendered', () => {
    const html = render();
    for (const label of ['Budget', 'Balanced', 'Better', 'Best', 'Loaded']) {
      expect(html).toContain(label);
    }
  });

  test('default provider (openai-tts) + tts-1 model id surfaced', () => {
    const html = render();
    expect(html).toContain('openai-tts');
    expect(html).toContain('tts-1');
  });

  test('per-million rate badge rendered for default balanced', () => {
    const html = render();
    // balanced = $0.0000150 × 1M = $15
    expect(html).toContain('$15/M chars');
  });

  test('a11y attributes', () => {
    const html = render();
    expect(html).toContain('aria-label="Voice playback tier"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuetext="Balanced"');
  });

  test('reset button label', () => {
    const html = render();
    expect(html).toContain('Reset to default (Balanced)');
  });
});
