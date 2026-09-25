// M1-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Mount surface contract for the STT tier slider card.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaemonProvider } from '@/components/providers/DaemonProvider';
import { VoiceModelTierCard } from './VoiceModelTierCard';

function render(): string {
  return renderToStaticMarkup(
    <DaemonProvider>
      <VoiceModelTierCard />
    </DaemonProvider>,
  );
}

describe('M1-2 · VoiceModelTierCard · mount surface', () => {
  test('exports a component', () => {
    expect(typeof VoiceModelTierCard).toBe('function');
  });

  test('SSR renders without throwing (localStorage absent)', () => {
    const html = render();
    expect(html).toContain('voice-model-tier-card');
    expect(html).toContain('voice-model-tier-slider');
    expect(html).toContain('voice-model-tier-rationale');
    expect(html).toContain('voice-model-tier-tick-labels');
    expect(html).toContain('voice-model-tier-reset');
  });

  test('default rendering = Balanced + "Smart default" badge', () => {
    const html = render();
    expect(html).toContain('Balanced');
    expect(html).toContain('voice-model-tier-default-badge');
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

  test('default tier model id (gpt-4o-mini-transcribe) is exposed for power users', () => {
    const html = render();
    expect(html).toContain('gpt-4o-mini-transcribe');
  });

  test('slider has accessibility attributes', () => {
    const html = render();
    expect(html).toContain('aria-label="Voice transcription tier"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuetext="Balanced"');
  });

  test('reset button shows default tier label', () => {
    const html = render();
    expect(html).toContain('Reset to default (Balanced)');
  });

  test('default render shows per-minute price (no usage data yet)', () => {
    const html = render();
    expect(html).toContain('0.003/min');
  });

  test('confirm modal not rendered on initial mount (no pending tier)', () => {
    const html = render();
    expect(html).not.toContain('tier-change-confirm-modal');
  });
});
