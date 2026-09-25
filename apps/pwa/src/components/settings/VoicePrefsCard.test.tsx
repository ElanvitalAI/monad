// C2 — VoicePrefsCard mount surface contract.

import { describe, test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoicePrefsCard } from './VoicePrefsCard';

describe('VoicePrefsCard — C2 mount surface', () => {
  test('exports a VoicePrefsCard component', () => {
    expect(typeof VoicePrefsCard).toBe('function');
  });

  test('renders without throwing (SSR pass · localStorage absent)', () => {
    const html = renderToStaticMarkup(<VoicePrefsCard />);
    expect(html).toContain('voice-prefs-card');
    expect(html).toContain('voice-prefs-multiplier-slider');
    expect(html).toContain('voice-prefs-multiplier-value');
    expect(html).toContain('voice-prefs-hint');
    expect(html).toContain('voice-prefs-reset');
  });

  test('default value 2.0× shows in label + slider', () => {
    const html = renderToStaticMarkup(<VoicePrefsCard />);
    expect(html).toContain('2.0×');
    expect(html).toContain('value="2"');
  });

  test('hint text reflects default tier (기본값)', () => {
    const html = renderToStaticMarkup(<VoicePrefsCard />);
    expect(html).toContain('기본값');
  });

  test('aria attributes on slider (accessibility)', () => {
    const html = renderToStaticMarkup(<VoicePrefsCard />);
    expect(html).toContain('aria-label="Speaking threshold multiplier"');
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="5"');
  });
});
