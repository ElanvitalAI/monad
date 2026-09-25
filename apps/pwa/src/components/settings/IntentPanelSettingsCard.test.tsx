// IntentPanelSettingsCard render contract — pins the 3-radio
// surface for the displayMode preference (fixed/popup/off). The
// container is exercised separately in IntentPanel.test.tsx;
// here we verify the settings UI renders all three options with
// the canonical labels + testids.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { IntentPanelSettingsCard } from './IntentPanelSettingsCard';

// Polyfill window for the storage shim that the card calls during
// initial render. SSR path returns the default (fixed) and the
// component renders the radio with that selected.
let originalWindow: unknown;
beforeAll(() => {
  originalWindow = (globalThis as { window?: unknown }).window;
});
afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

describe('IntentPanelSettingsCard — render contract', () => {
  test('renders the section testid + heading', () => {
    const html = renderToStaticMarkup(<IntentPanelSettingsCard />);
    expect(html).toContain('data-testid="intent-panel-settings"');
    expect(html).toContain('Intent Panel');
  });

  test('renders 3 mode options (fixed · popup · off)', () => {
    const html = renderToStaticMarkup(<IntentPanelSettingsCard />);
    expect(html).toContain('data-testid="intent-panel-mode-fixed"');
    expect(html).toContain('data-testid="intent-panel-mode-popup"');
    expect(html).toContain('data-testid="intent-panel-mode-off"');
  });

  test('blurbs explain each option', () => {
    const html = renderToStaticMarkup(<IntentPanelSettingsCard />);
    expect(html).toContain('항상 표시');
    expect(html).toContain('자동 dismiss');
    expect(html).toContain('완전 숨김');
  });

  test('radio group has accessible label + name', () => {
    const html = renderToStaticMarkup(<IntentPanelSettingsCard />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="intent panel display mode"');
    // All radios share the same `name` so the browser groups them.
    expect(html.match(/name="intent-panel-display-mode"/g)?.length).toBe(3);
  });

  test('SSR initial render leaves no radio active (mounted=false)', () => {
    // The component sets `mounted=true` only after useEffect on the
    // client; SSR should render with no `data-active="true"` so
    // hydration matches whatever localStorage yields on mount.
    const html = renderToStaticMarkup(<IntentPanelSettingsCard />);
    expect(html).not.toContain('data-active="true"');
  });
});
