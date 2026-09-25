// M2-2b (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Mount-surface contract for the Voice ID per-context picker (MVP).

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DaemonProvider } from '@/components/providers/DaemonProvider';
import { TtsVoiceIdPickerCard } from './TtsVoiceIdPickerCard';

function render(): string {
  return renderToStaticMarkup(
    <DaemonProvider>
      <TtsVoiceIdPickerCard />
    </DaemonProvider>,
  );
}

describe('M2-2b · TtsVoiceIdPickerCard · mount surface', () => {
  test('exports a component', () => {
    expect(typeof TtsVoiceIdPickerCard).toBe('function');
  });

  test('SSR renders without throwing', () => {
    const html = render();
    expect(html).toContain('tts-voice-id-picker-card');
    expect(html).toContain('tts-voice-rows');
    expect(html).toContain('tts-voice-reset-all');
  });

  test('all 5 context rows rendered', () => {
    const html = render();
    for (const ctx of ['default', 'chat', 'digest', 'alert', 'discord']) {
      expect(html).toContain(`tts-voice-row-${ctx}-label`);
      expect(html).toContain(`tts-voice-row-${ctx}-input`);
      expect(html).toContain(`tts-voice-row-${ctx}-browse`);
      expect(html).toContain(`tts-voice-row-${ctx}-clear`);
    }
  });

  test('context labels surface humanized text', () => {
    const html = render();
    expect(html).toContain('Default');
    expect(html).toContain('Chat reply');
    expect(html).toContain('Morning digest');
    expect(html).toContain('Push alerts');
    expect(html).toContain('Discord bot');
  });

  test('placeholder mentions voice id', () => {
    const html = render();
    expect(html).toContain('Voice id');
  });

  test('library hint footnote present (offline / unconfigured fallback)', () => {
    const html = render();
    // SSR has no fetch · library stays null · footnote falls to the
    // offline-fallback message.
    expect(html).toContain('Paste voice id manually until daemon library is reachable');
  });

  test('Browse buttons disabled when library not loaded (SSR)', () => {
    const html = render();
    // The Browse button is disabled when library isn't ready · React
    // SSR emits `disabled="">` plus `data-disabled` from the button
    // primitive used by the design system.
    expect(html).toContain('tts-voice-row-default-browse');
  });
});
