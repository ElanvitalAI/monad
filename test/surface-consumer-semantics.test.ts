import { describe, expect, test } from 'bun:test';
import { buildMouseInputEventFromDisplay, createContextKeyService } from '../src/input-core/index.js';
import { hitKey } from '../src/ui/context-menu-providers.js';
import { surfaceKindFamilyPolicy } from '../src/surface/z-tier.js';
import {
  surfaceAddressFromHit,
  surfaceKindFromHit,
} from '../src/surface/hit-projection.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import { publishMouseTargetToContextKeys } from '../src/input-core/mouse-context-publisher.js';

function dsp(hitTarget: DisplayMouseEvent['hitTarget']): DisplayMouseEvent {
  return {
    type: 'click',
    row: 5,
    col: 10,
    hitTarget,
  };
}

describe('R5.4 · cross-system surface semantics invariants', () => {
  test('input hit aligns across hit projection, context keys, and menu keys', () => {
    const hit = { kind: 'input', inputId: 'chat-main' } as const;
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(buildMouseInputEventFromDisplay(dsp(hit)), cks);

    expect(surfaceKindFromHit(hit)).toBe('input');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'input', inputId: 'chat-main' });
    expect(surfaceKindFamilyPolicy(surfaceKindFromHit(hit)!)?.family).toBe('host-derived-input');
    expect(hitKey(hit)).toBe('input:chat-main');
    expect(cks.keys.hitTargetKind).toBe('input');
    expect(cks.keys.hitTargetSurfaceKind).toBe('input');
    expect(cks.keys.hitTargetInputId).toBe('chat-main');
    expect(cks.keys.hitTargetPaneId).toBeNull();
  });

  test('modal hit aligns across hit projection, context keys, and menu keys', () => {
    const hit = { kind: 'modal-button', modalId: 'approval-1', buttonId: 'ok' } as const;
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(buildMouseInputEventFromDisplay(dsp(hit)), cks);

    expect(surfaceKindFromHit(hit)).toBe('modal');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'modal', modalId: 'approval-1' });
    expect(surfaceKindFamilyPolicy(surfaceKindFromHit(hit)!)?.family).toBe('modal-stack');
    expect(hitKey(hit)).toBe('modal-button:ok');
    expect(cks.keys.hitTargetKind).toBe('modal-button');
    expect(cks.keys.hitTargetSurfaceKind).toBe('modal');
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });

  test('vw pane hit aligns across hit projection, context keys, and menu keys', () => {
    const hit = { kind: 'vw-pane-title', windowId: '7', paneId: 'editor' } as const;
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(buildMouseInputEventFromDisplay(dsp(hit)), cks);

    expect(surfaceKindFromHit(hit)).toBe('pane');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'pane', ref: { windowId: '7', paneId: 'editor' } });
    expect(surfaceKindFamilyPolicy(surfaceKindFromHit(hit)!)?.family).toBe('vw-host');
    expect(hitKey(hit)).toBe('vw-pane-title:7:editor');
    expect(cks.keys.hitTargetKind).toBe('vw-pane-title');
    expect(cks.keys.hitTargetSurfaceKind).toBe('pane');
    expect(cks.keys.hitTargetPaneId).toBe('editor');
    expect(cks.keys.hitTargetInputId).toBeNull();
  });

  test('pill hit remains non-addressable across the same consumers', () => {
    const hit = { kind: 'pill', name: 'model' } as const;
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(buildMouseInputEventFromDisplay(dsp(hit)), cks);

    expect(surfaceKindFromHit(hit)).toBeNull();
    expect(surfaceAddressFromHit(hit)).toBeNull();
    expect(hitKey(hit)).toBe('pill:model');
    expect(cks.keys.hitTargetKind).toBe('pill');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });
});
