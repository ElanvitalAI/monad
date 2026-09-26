// PR-D follow-up (PWA surface picker · 2026-05-13) — render contract
// for the cycle-button <SurfacePicker>. The original 4-button
// segmented control took too much header space; the picker is now a
// single pill that rotates through default → readonly → chat →
// webterm → default on each click.
//
// Bun's PWA test env has no React Testing Library, so we drive the
// component through react-dom/server's renderToStaticMarkup and grep
// for structural markers a future regression would lose:
//   - data-elanous-surface-picker on the button
//   - data-elanous-surface-current carries the active kind label
//   - aria-label hints at the next target
//   - cycle math (nextSurfacePreference) covers the full rotation

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  SurfacePicker,
  nextSurfacePreference,
  surfacePreferenceToWire,
} from './SurfacePicker';
import {
  SURFACE_PREFERENCE_KEY,
  setSurfacePreference,
} from '@/lib/surface-preference';

interface FakeEnv {
  store: Record<string, string>;
  restore: () => void;
}

function withFakeWindow(): FakeEnv {
  const store: Record<string, string> = {};
  const fakeStorage = {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  const fakeWindow = {
    localStorage: fakeStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const realWindow = (globalThis as { window?: unknown }).window;
  const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { window?: unknown }).window = fakeWindow;
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  return {
    store,
    restore: () => {
      (globalThis as { window?: unknown }).window = realWindow;
      (globalThis as { localStorage?: unknown }).localStorage = realLocalStorage;
    },
  };
}

describe('SurfacePicker — render contract (cycle button)', () => {
  let env: FakeEnv;
  beforeEach(() => { env = withFakeWindow(); });
  afterEach(() => { env.restore(); });

  test('renders a single button with the surface-picker data marker', () => {
    const html = renderToStaticMarkup(<SurfacePicker />);
    expect(html).toMatch(/data-elanous-surface-picker/);
    // Single button — no role="radiogroup"/"radio" remnants.
    expect(html).not.toMatch(/role="radiogroup"/);
    expect(html).not.toMatch(/role="radio"/);
  });

  test('default state surfaces "default" via data marker + label text', () => {
    const html = renderToStaticMarkup(<SurfacePicker />);
    expect(html).toMatch(/data-elanous-surface-current="default"/);
    expect(html).toMatch(/>default</);
  });

  test('stored "chat" preference renders the chat surface as current', () => {
    env.store[SURFACE_PREFERENCE_KEY] = 'chat';
    const html = renderToStaticMarkup(<SurfacePicker />);
    expect(html).toMatch(/data-elanous-surface-current="chat"/);
    expect(html).toMatch(/>chat</);
    // The hover hint advertises the next target in the cycle.
    expect(html).toMatch(/aria-label="[^"]*chat[^"]*switch to webterm/);
  });

  test('setSurfacePreference("webterm") flips the rendered current marker', () => {
    setSurfacePreference('webterm');
    const html = renderToStaticMarkup(<SurfacePicker />);
    expect(html).toMatch(/data-elanous-surface-current="webterm"/);
    expect(html).toMatch(/>webterm</);
  });

  test('aria-label always names current + next in the cycle for screen readers', () => {
    // default → readonly
    expect(renderToStaticMarkup(<SurfacePicker />)).toMatch(
      /aria-label="[^"]*default[^"]*switch to readonly/,
    );
    setSurfacePreference('readonly');
    expect(renderToStaticMarkup(<SurfacePicker />)).toMatch(
      /aria-label="[^"]*readonly[^"]*switch to chat/,
    );
    setSurfacePreference('chat');
    expect(renderToStaticMarkup(<SurfacePicker />)).toMatch(
      /aria-label="[^"]*chat[^"]*switch to webterm/,
    );
    setSurfacePreference('webterm');
    expect(renderToStaticMarkup(<SurfacePicker />)).toMatch(
      /aria-label="[^"]*webterm[^"]*switch to default/,
    );
  });

  test('title text describes the current surface for hover discovery', () => {
    setSurfacePreference('readonly');
    const html = renderToStaticMarkup(<SurfacePicker />);
    expect(html).toMatch(/title="[^"]*readonly[^"]*Read[^"]*Grep[^"]*WebSearch/);
    setSurfacePreference('webterm');
    const html2 = renderToStaticMarkup(<SurfacePicker />);
    expect(html2).toMatch(/title="[^"]*webterm[^"]*WebTerminal/);
  });
});

describe('nextSurfacePreference — cycle rotation', () => {
  test('rotates default → readonly → chat → webterm → default', () => {
    expect(nextSurfacePreference(null)).toBe('readonly');
    expect(nextSurfacePreference('readonly')).toBe('chat');
    expect(nextSurfacePreference('chat')).toBe('webterm');
    expect(nextSurfacePreference('webterm')).toBe(null);
  });
});

describe('surfacePreferenceToWire', () => {
  test('returns the kind for non-null preferences', () => {
    expect(surfacePreferenceToWire('readonly')).toBe('readonly');
    expect(surfacePreferenceToWire('chat')).toBe('chat');
    expect(surfacePreferenceToWire('webterm')).toBe('webterm');
    expect(surfacePreferenceToWire('none')).toBe('none');
  });

  test('returns undefined for null (so the request omits the field)', () => {
    expect(surfacePreferenceToWire(null)).toBeUndefined();
  });
});
