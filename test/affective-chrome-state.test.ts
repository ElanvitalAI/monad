import { describe, expect, test } from 'bun:test';
import { DEFAULT_WIDGET_TOKENS } from '../src/theme/tokens.js';
import { resolveAffectiveChromeMotionPolicy } from '../src/ui/chrome/affective-chrome-state.js';
import { resolveModalChromeMotion } from '../src/ui/chrome/modal-chrome-box.js';

describe('affective chrome state', () => {
  test('neutral falls back to the base chrome motion policy', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const resolved = resolveAffectiveChromeMotionPolicy(chrome, 'neutral');
    expect(resolved.mode).toBe('static');
    expect(resolved.recipe).toBe('focus-swap');
    expect(resolved.target).toBe('frame-and-title');
  });

  test('thinking prefers title-bar pulse when motion is allowed', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const resolved = resolveAffectiveChromeMotionPolicy(chrome, 'thinking');
    expect(resolved.mode).toBe('motion');
    expect(resolved.recipe).toBe('pulse');
    expect(resolved.target).toBe('title-bar');
  });

  test('approval-required maps to audit pulse and degrades to static', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const resolved = resolveAffectiveChromeMotionPolicy(chrome, 'approval-required', {
      motionDisabled: true,
    });
    expect(resolved.mode).toBe('static');
    expect(resolved.recipe).toBe('audit-pulse');
    expect(resolved.target).toBe('title-bar');
  });

  test('modal chrome motion helper accepts affective state', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const resolved = resolveModalChromeMotion(chrome, {
      affectiveState: 'tentative',
    });
    expect(resolved.mode).toBe('static');
    expect(resolved.recipe).toBe('focus-swap');
    expect(resolved.target).toBe('title-bar');
  });
});
