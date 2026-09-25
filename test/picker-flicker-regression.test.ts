// Bugfix 2026-05-03 — `/` slash menu severe flicker.
//
// Root cause: chat slash/at/skill/arg pickers declared `focus:'participates'`
// (paint-only · onKey via dispatch chain) but `isOverlayInputSurface`
// classified them as overlay-input owners (`focus !== 'none'`). That
// suppressed chat-main → `shouldSyncPickers()` returned false →
// `pickerModalRuntime.clearAll()` popped the picker → suppression
// released → next render re-pushed the picker → ~30 Hz feedback loop.
//
// User-visible: severe flicker on `/` press, persistent.
//
// This regression test pins the root invariant: a `focus:'participates'`
// picker MUST NOT count as an overlay-input owner. The dispatch
// ownership and the input ownership are different concepts.
//
// Related context:
//   - `src/dashboard/input/overlay-input.ts` — `isOverlayInputSurface`
//   - `src/chat/index.ts` — `syncActivePickerModal` (consumer of
//     `shouldSyncPickers()`)
//   - `src/chat/pickers/modal-runtime.ts` — `syncModal`/`clearAll` pair
//     whose alternation produced the visible flicker
//   - log/debug-20260503134248.log captured the original 29-cycle proof

import { describe, expect, test } from 'bun:test';
import { hasOverlayInputOwner, isOverlayInputSurface } from '../src/dashboard/input/overlay-input.js';
import type { DisplaySurface, SurfaceId } from '../src/display/types.js';

function chatSlashPicker(id: string): DisplaySurface {
  // Mirrors the actual surface produced by src/chat/pickers/modals.ts
  // for the slash picker — focus: 'participates' when an onKey is
  // wired (which is always, in practice).
  return {
    id: id as SurfaceId,
    kind: 'modal',
    owner: 'dashboard',
    priority: 100,
    focus: 'participates',
    tier: 'picker',
    bounds: { row: 28, col: 1, width: 170, height: 9 },
    paint: () => '',
    render: () => [],
  };
}

describe('picker-flicker regression — `/` slash menu', () => {
  test('chat slash picker (focus:participates) does NOT own overlay input', () => {
    const picker = chatSlashPicker('chat:slash-picker:test');
    expect(isOverlayInputSurface(picker)).toBe(false);
  });

  test('hasOverlayInputOwner returns false when only chat pickers are on stack', () => {
    // The exact scenario captured in the 2026-05-03 incident log:
    // pane:input is the underlying focus stack entry; the slash picker
    // is mounted ON TOP. With the bug, hasOverlayInputOwner returned
    // true, suppressing chat-main and triggering the clearAll loop.
    const picker = chatSlashPicker('chat:slash-picker:flickergate');
    expect(hasOverlayInputOwner({
      focusStack: ['pane:input' as SurfaceId, picker.id],
      surfaceAt: (id) => (id === picker.id ? picker : null),
    })).toBe(false);
  });

  test('a focus:owns dialog above a chat picker still owns overlay input (other path unaffected)', () => {
    // Sanity: the fix only affects the `participates` case. A real
    // popup/dialog with `focus:'owns'` (e.g. ask-user dialog opened
    // ON TOP of a slash picker) must still register as overlay input
    // — otherwise we break legitimate input ownership.
    const picker = chatSlashPicker('chat:slash-picker:undertop');
    const dialog: DisplaySurface = {
      id: 'dialog:1' as SurfaceId,
      kind: 'modal',
      owner: 'dashboard',
      priority: 100,
      focus: 'owns',
      tier: 'dialog',
      bounds: { row: 5, col: 5, width: 30, height: 8 },
      paint: () => '',
      render: () => [],
    };
    const map = new Map<SurfaceId, DisplaySurface>([
      [picker.id, picker],
      [dialog.id, dialog],
    ]);
    expect(hasOverlayInputOwner({
      focusStack: [picker.id, dialog.id],
      surfaceAt: (id) => map.get(id) ?? null,
    })).toBe(true);
  });
});
