import { describe, expect, test } from 'bun:test';
import { DEFAULT_WIDGET_TOKENS } from '../src/theme/tokens.js';
import {
  resolveModalChromeBoxOptions,
  resolveModalChromeMotion,
} from '../src/ui/chrome/modal-chrome-box.js';

describe('modal chrome box helper', () => {
  test('motion policy defaults to static and inherits chromeTarget', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const motion = resolveModalChromeMotion(chrome);
    expect(motion.mode).toBe('static');
    expect(motion.recipe).toBe('focus-swap');
    expect(motion.target).toBe(chrome.chromeTarget);
  });

  test('motionDisabled forces static mode without losing target', () => {
    const chrome = {
      ...DEFAULT_WIDGET_TOKENS.modalChrome!,
      motionPolicy: {
        mode: 'motion' as const,
        recipe: 'pulse' as const,
        target: 'title-bar' as const,
      },
    };
    const motion = resolveModalChromeMotion(chrome, { motionDisabled: true });
    expect(motion.mode).toBe('static');
    expect(motion.recipe).toBe('pulse');
    expect(motion.target).toBe('title-bar');
  });

  test('title-bar target degrades frame variant to plain while keeping title rail', () => {
    const chrome = {
      ...DEFAULT_WIDGET_TOKENS.modalChrome!,
      chromeVariant: 'rounded' as const,
      motionPolicy: {
        mode: 'motion' as const,
        recipe: 'pulse' as const,
        target: 'title-bar' as const,
      },
    };
    const opts = resolveModalChromeBoxOptions(chrome, {
      title: 'Preview',
      titleRight: '✕',
    });
    expect(opts.borderVariant).toBe('plain');
    expect(opts.focusedBorderVariant).toBe('plain');
    expect(opts.titleBarStyle).toBeTruthy();
    expect(opts.focusedTitleBarStyle).toBeTruthy();
  });

  test('affective state can steer the target without changing callers', () => {
    const chrome = DEFAULT_WIDGET_TOKENS.modalChrome!;
    const opts = resolveModalChromeBoxOptions(chrome, {
      title: 'Preview',
      titleRight: '✕',
      affectiveState: 'thinking',
    });
    expect(opts.borderVariant).toBe('plain');
    expect(opts.focusedBorderVariant).toBe('plain');
    expect(opts.titleBarStyle).toBeTruthy();
  });
});
