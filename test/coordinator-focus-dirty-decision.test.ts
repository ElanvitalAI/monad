// Regression test for the host-chrome / prior-surface dirty
// decision in setFocus.
//
// Bug being prevented: when the popup browser modal is open and the
// user navigates internally (focus shuffles between two surfaces both
// inside the same blocking modal), `markDirty('status')` and
// `markDirty('dock')` were being fired on every focus change. The
// visible symptom was top + bottom of the screen continuously
// repainting in the background.
//
// Fix: if the surface that WILL HOLD focus covers host chrome
// (interactionClass === 'blocking-modal' + blocksHostInput), there's
// no point dirtying host chrome — it's hidden anyway.

import { describe, expect, test } from 'bun:test';

import {
  shouldDirtyHostChromeForFocusChange,
  shouldDirtyPriorSurfaceForFocusChange,
} from '../src/display/coordinator.js';

// Minimal DisplaySurface stubs — only the fields the dirty decision
// reads are populated.
function workspaceSurface(id: string): unknown {
  return {
    id,
    interactionClass: 'workspace' as const,
    backgroundInteractionPolicy: 'allow' as const,
  };
}
function blockingModalSurface(id: string): unknown {
  return {
    id,
    interactionClass: 'blocking-modal' as const,
    backgroundInteractionPolicy: 'block' as const,
  };
}
function embeddedOverlaySurface(id: string): unknown {
  return {
    id,
    interactionClass: 'embedded-overlay' as const,
    backgroundInteractionPolicy: 'allow' as const,
  };
}

describe('shouldDirtyHostChromeForFocusChange', () => {
  test('opening a blocking modal does NOT dirty host chrome', () => {
    // Workspace → blocking modal: host chrome will be covered.
    expect(shouldDirtyHostChromeForFocusChange(
      workspaceSurface('main') as never,
      blockingModalSurface('popup') as never,
    )).toBe(false);
  });

  test('navigating between two blocking modals (popup-internal nav) does NOT dirty host chrome — the bug fix', () => {
    // The popup-browser bug — focus moves from one inner surface to
    // another, both inside the same blocking-modal stack. Host chrome
    // is still hidden under the popup.
    expect(shouldDirtyHostChromeForFocusChange(
      blockingModalSurface('popup-inner-a') as never,
      blockingModalSurface('popup-inner-b') as never,
    )).toBe(false);
  });

  test('closing a blocking modal (modal → workspace) DOES dirty host chrome', () => {
    // Host chrome is reappearing — must repaint.
    expect(shouldDirtyHostChromeForFocusChange(
      blockingModalSurface('popup') as never,
      workspaceSurface('main') as never,
    )).toBe(true);
  });

  test('workspace → workspace transition DOES dirty host chrome', () => {
    // Status / dock content may depend on the focused workspace.
    expect(shouldDirtyHostChromeForFocusChange(
      workspaceSurface('window-1') as never,
      workspaceSurface('window-2') as never,
    )).toBe(true);
  });

  test('embedded overlay (companion) → workspace DOES dirty host chrome', () => {
    expect(shouldDirtyHostChromeForFocusChange(
      embeddedOverlaySurface('companion') as never,
      workspaceSurface('main') as never,
    )).toBe(true);
  });

  test('workspace → embedded overlay DOES dirty host chrome', () => {
    // Embedded overlays are NOT blocking — host chrome is still
    // visible alongside them.
    expect(shouldDirtyHostChromeForFocusChange(
      workspaceSurface('main') as never,
      embeddedOverlaySurface('companion') as never,
    )).toBe(true);
  });

  test('null / undefined surfaces are handled (initial focus / clear)', () => {
    expect(shouldDirtyHostChromeForFocusChange(null, blockingModalSurface('popup') as never)).toBe(false);
    expect(shouldDirtyHostChromeForFocusChange(blockingModalSurface('popup') as never, null)).toBe(true);
    expect(shouldDirtyHostChromeForFocusChange(null, null)).toBe(true);
  });
});

describe('shouldDirtyPriorSurfaceForFocusChange', () => {
  test('focus moving INTO a blocking modal does NOT dirty the prior surface', () => {
    // Prior will be fully covered by the modal — repainting it just
    // to drop the focus indicator is wasted work.
    expect(shouldDirtyPriorSurfaceForFocusChange(
      workspaceSurface('main') as never,
      blockingModalSurface('popup') as never,
    )).toBe(false);
  });

  test('navigating between blocking modals does NOT dirty the prior — the bug fix companion', () => {
    expect(shouldDirtyPriorSurfaceForFocusChange(
      blockingModalSurface('popup-a') as never,
      blockingModalSurface('popup-b') as never,
    )).toBe(false);
  });

  test('focus moving OUT of a blocking modal DOES dirty the (revealed) prior surface', () => {
    // The workspace is becoming visible again — focus indicator may
    // need to update.
    expect(shouldDirtyPriorSurfaceForFocusChange(
      blockingModalSurface('popup') as never,
      workspaceSurface('main') as never,
    )).toBe(true);
  });

  test('workspace → workspace dirties prior (focus border swap)', () => {
    expect(shouldDirtyPriorSurfaceForFocusChange(
      workspaceSurface('main-1') as never,
      workspaceSurface('main-2') as never,
    )).toBe(true);
  });
});
