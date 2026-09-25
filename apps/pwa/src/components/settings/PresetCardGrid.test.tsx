// M2-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Mount-surface contract for the preset card grid.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaemonProvider } from '@/components/providers/DaemonProvider';
import { PresetCardGrid } from './PresetCardGrid';

function render(): string {
  return renderToStaticMarkup(
    <DaemonProvider>
      <PresetCardGrid />
    </DaemonProvider>,
  );
}

describe('M2-3 · PresetCardGrid · mount surface', () => {
  test('exports a component', () => {
    expect(typeof PresetCardGrid).toBe('function');
  });

  test('SSR renders without throwing', () => {
    const html = render();
    expect(html).toContain('preset-card-grid');
    expect(html).toContain('preset-card-list');
  });

  test('5 preset cards rendered with humanized labels', () => {
    const html = render();
    for (const id of ['casual_chat', 'meeting', 'medical_dictation', 'live_caption', 'sleep_mode']) {
      expect(html).toContain(`preset-card-${id}`);
    }
    expect(html).toContain('Casual chat');
    expect(html).toContain('Meeting notes');
    expect(html).toContain('Medical / legal dictation');
    expect(html).toContain('Live captioning');
    expect(html).toContain('Sleep mode');
  });

  test('preset icons rendered', () => {
    const html = render();
    expect(html).toContain('💬');
    expect(html).toContain('📋');
    expect(html).toContain('🏥');
    expect(html).toContain('🎬');
    expect(html).toContain('🌙');
  });

  test('tier badges show stt/llm/tts/cap', () => {
    const html = render();
    expect(html).toContain('stt:loaded');
    expect(html).toContain('llm:best');
    expect(html).toContain('tts:best');
    expect(html).toContain('cap:$20');
  });

  test('no active-preset banner on initial mount (localStorage absent in SSR)', () => {
    const html = render();
    expect(html).not.toContain('preset-active-banner');
  });
});
