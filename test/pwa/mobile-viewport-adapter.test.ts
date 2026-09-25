// ── D (Phase 3 Bundle 2) — mobile-viewport-adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  classifyDevice,
  computeMobileViewportLayout,
  shouldRelayout,
} from '../../src/pwa/mobile-viewport-adapter';

describe('classifyDevice', () => {
  test('phone-portrait when width < 600', () => {
    expect(classifyDevice({ width: 375, height: 812 })).toBe('phone-portrait');
    expect(classifyDevice({ width: 599, height: 700 })).toBe('phone-portrait');
  });

  test('phone-landscape when width 600-899 + height < 500', () => {
    expect(classifyDevice({ width: 812, height: 375 })).toBe('phone-landscape');
    expect(classifyDevice({ width: 700, height: 400 })).toBe('phone-landscape');
  });

  test('tablet when width 600-1199 + height >= 500', () => {
    expect(classifyDevice({ width: 768, height: 1024 })).toBe('tablet');
    expect(classifyDevice({ width: 1024, height: 768 })).toBe('tablet');
    expect(classifyDevice({ width: 1199, height: 800 })).toBe('tablet');
  });

  test('desktop when width >= 1200', () => {
    expect(classifyDevice({ width: 1200, height: 800 })).toBe('desktop');
    expect(classifyDevice({ width: 1920, height: 1080 })).toBe('desktop');
  });
});

describe('computeMobileViewportLayout', () => {
  test('phone-portrait → stack arrangement', () => {
    const layout = computeMobileViewportLayout({ width: 375, height: 812 });
    expect(layout.category).toBe('phone-portrait');
    expect(layout.arrangement).toBe('stack');
    expect(layout.chatSize).toBe(Math.floor(812 * 0.4));
    expect(layout.terminalSize).toBe(812 - Math.floor(812 * 0.4));
    expect(layout.fontSize.chat).toBe(16);
    expect(layout.fontSize.terminal).toBe(14);
    expect(layout.touchTargetMin).toBe(44);
  });

  test('phone-landscape → split-h', () => {
    const layout = computeMobileViewportLayout({ width: 812, height: 375 });
    expect(layout.arrangement).toBe('split-h');
    expect(layout.chatSize).toBe(Math.floor(812 * 0.4));
    expect(layout.terminalSize).toBe(812 - Math.floor(812 * 0.4));
  });

  test('tablet → split-h with smaller chat ratio', () => {
    const layout = computeMobileViewportLayout({ width: 1024, height: 768 });
    expect(layout.arrangement).toBe('split-h');
    expect(layout.chatSize).toBe(Math.floor(1024 * 0.35));
    expect(layout.touchTargetMin).toBe(40);
  });

  test('desktop → split-v (TUI parity)', () => {
    const layout = computeMobileViewportLayout({ width: 1920, height: 1080 });
    expect(layout.arrangement).toBe('split-v');
    expect(layout.chatSize).toBe(Math.floor(1080 * 0.4));
    expect(layout.touchTargetMin).toBe(32);
  });

  test('softKeyboardOpen halves usable height + sets recomputeNeeded', () => {
    const layout = computeMobileViewportLayout({
      width: 375, height: 812, softKeyboardOpen: true,
    });
    expect(layout.recomputeNeeded).toBe(true);
    // usable = 812 * 0.5 = 406, chat = 162, term = 244
    expect(layout.chatSize).toBe(Math.floor(406 * 0.4));
  });
});

describe('shouldRelayout', () => {
  test('different category → true', () => {
    const a = computeMobileViewportLayout({ width: 375, height: 812 });
    const b = computeMobileViewportLayout({ width: 1024, height: 768 });
    expect(shouldRelayout(a, b)).toBe(true);
  });

  test('different arrangement → true', () => {
    const a = computeMobileViewportLayout({ width: 1920, height: 1080 });  // split-v
    const b = computeMobileViewportLayout({ width: 1024, height: 768 });   // split-h
    expect(shouldRelayout(a, b)).toBe(true);
  });

  test('same category + arrangement → false (only sizes change)', () => {
    const a = computeMobileViewportLayout({ width: 375, height: 812 });
    const b = computeMobileViewportLayout({ width: 414, height: 896 });
    expect(shouldRelayout(a, b)).toBe(false);
  });
});
