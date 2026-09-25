import { describe, expect, test } from 'bun:test';
import { shouldFreezeDashboardBottomArea } from '../src/display/bottom-area-freeze.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function modalSurface(overrides: Partial<ModalSurface> = {}): ModalSurface {
  return {
    id: 'modal:test',
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 250,
    tier: 'popup',
    bounds: { row: 18, col: 10, width: 20, height: 6 },
    interactiveBounds: { row: 18, col: 10, width: 20, height: 6 },
    visualBounds: { row: 18, col: 10, width: 20, height: 6 },
    paint: () => '',
    ...overrides,
  };
}

describe('shouldFreezeDashboardBottomArea', () => {
  const promptFrame = {
    inputHeight: 2,
    promptTopRow: 18,
    promptBottomRow: 19,
    topDividerRow: 17,
    bottomDividerRow: 20,
  } as const;

  test('freezes popup-tier modal overlapping the prompt/status/dock band', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface(),
      promptFrame,
      24,
    )).toBe(true);
  });

  test('does not freeze popup-tier modal above the bottom area band', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({
        bounds: { row: 4, col: 10, width: 20, height: 6 },
        interactiveBounds: { row: 4, col: 10, width: 20, height: 6 },
        visualBounds: { row: 4, col: 10, width: 20, height: 6 },
      }),
      promptFrame,
      24,
    )).toBe(false);
  });

  test('does not freeze companion popups', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({ windowRole: 'companion' }),
      promptFrame,
      24,
    )).toBe(false);
  });

  test('does not freeze workspace-class virtual windows even if they reuse modal primitives', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({
        tier: 'vw',
        hostChromeProfile: 'hud-status-input-dock',
        interactionClass: 'workspace',
        backgroundInteractionPolicy: 'block',
        windowRole: 'foreground',
      }),
      promptFrame,
      24,
    )).toBe(false);
  });

  test('does not freeze blocking foreground dialogs', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({
        tier: 'dialog',
        backgroundInteractionPolicy: 'block',
      }),
      promptFrame,
      24,
    )).toBe(false);
  });

  test('does not freeze picker-tier overlays like slash/search pickers', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({
        tier: 'picker',
      }),
      promptFrame,
      24,
    )).toBe(false);
  });

  test('does not freeze lightweight dock popups that opt out explicitly', () => {
    expect(shouldFreezeDashboardBottomArea(
      modalSurface({
        freezeBottomArea: false,
      }),
      promptFrame,
      24,
    )).toBe(false);
  });
});
