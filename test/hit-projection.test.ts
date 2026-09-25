import { describe, expect, test } from 'bun:test';
import type { HitTarget, SurfaceId } from '../src/display/types.js';
import {
  hitFromSurfaceId,
  hitKeyFromHit,
  hitMatchesSurfaceId,
  legacyHitKeyAliasesFromHit,
  legacySurfaceIdAliasesFromHit,
  surfaceKindFromHit,
  surfaceAddressFromSurfaceId,
  surfaceAddressFromHit,
  surfaceIdFromHit,
  wildcardHitKeyFromHit,
} from '../src/surface/hit-projection.js';

describe('R8g · hit projection helper', () => {
  test('vw pane canonical hit key includes window id', () => {
    const hit: HitTarget = { kind: 'vw-pane-body', windowId: '7', paneId: 'editor' };
    expect(hitKeyFromHit(hit)).toBe('vw-pane-body:7:editor');
    expect(legacyHitKeyAliasesFromHit(hit)).toEqual(['vw-pane-body:editor']);
  });

  test('wildcard projection is stable across vw pane keys', () => {
    const hit: HitTarget = { kind: 'vw-pane-title', windowId: '3', paneId: 'right' };
    expect(wildcardHitKeyFromHit(hit)).toBe('vw-pane-title:*');
  });

  test('input hit projects to canonical surface id', () => {
    const hit: HitTarget = { kind: 'input', inputId: 'chat-main' };
    expect(surfaceIdFromHit(hit)).toBe('input::chat-main');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('modal hit projects to canonical modal surface id', () => {
    const hit: HitTarget = { kind: 'modal-body', modalId: 'approval-1' as SurfaceId };
    expect(surfaceIdFromHit(hit)).toBe('modal::approval-1');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'modal', modalId: 'approval-1' });
  });

  test('modal title hit projects to the same canonical modal surface id', () => {
    const hit: HitTarget = { kind: 'modal-title', modalId: 'approval-1' as SurfaceId };
    expect(hitKeyFromHit(hit)).toBe('modal-title:approval-1');
    expect(wildcardHitKeyFromHit(hit)).toBe('modal-title:*');
    expect(surfaceIdFromHit(hit)).toBe('modal::approval-1');
    expect(surfaceAddressFromHit(hit)).toEqual({ kind: 'modal', modalId: 'approval-1' });
    expect(legacySurfaceIdAliasesFromHit(hit)).toEqual([]);
    expect(hitMatchesSurfaceId(hit, 'modal::approval-1' as SurfaceId)).toBe(true);
  });

  test('surface id inverse is partial and only handles canonical reversible ids', () => {
    expect(hitFromSurfaceId('input::chat-main' as SurfaceId)).toEqual({ kind: 'input', inputId: 'chat-main' });
    expect(hitFromSurfaceId('modal::approval-1' as SurfaceId)).toEqual({ kind: 'modal-body', modalId: 'approval-1' });
    expect(hitFromSurfaceId('wd-browser' as SurfaceId)).toBeNull();
  });

  test('surface address inverse matches canonical reversible ids', () => {
    expect(surfaceAddressFromSurfaceId('input::chat-main' as SurfaceId)).toEqual({ kind: 'input', inputId: 'chat-main' });
    expect(surfaceAddressFromSurfaceId('modal::approval-1' as SurfaceId)).toEqual({ kind: 'modal', modalId: 'approval-1' });
    expect(surfaceAddressFromSurfaceId('wd-browser' as SurfaceId)).toBeNull();
  });

  test('hitMatchesSurfaceId keeps strict input:: matching and legacy fallback', () => {
    const hit: HitTarget = { kind: 'input', inputId: 'chat-main' };
    expect(hitMatchesSurfaceId(hit, 'input::chat-main' as SurfaceId)).toBe(true);
    expect(hitMatchesSurfaceId(hit, 'input::llm-context-drop' as SurfaceId)).toBe(false);
    expect(hitMatchesSurfaceId(hit, 'legacy-input-target' as SurfaceId)).toBe(true);
  });

  test('local pane hits stay legacy-only, while vw hits can form canonical pane ids', () => {
    const paneHit: HitTarget = { kind: 'pane-body', paneId: 'wd-browser' };
    const vwHit: HitTarget = { kind: 'vw-pane-body', windowId: '7', paneId: 'vw-pane:7:right' };

    expect(surfaceIdFromHit(paneHit)).toBeNull();
    expect(surfaceIdFromHit(vwHit)).toBe('pane::7::vw-pane:7:right::');
    expect(legacySurfaceIdAliasesFromHit(paneHit)).toEqual(['wd-browser']);
    expect(legacySurfaceIdAliasesFromHit(vwHit)).toEqual(['vw-pane:7:right']);
    expect(hitMatchesSurfaceId(paneHit, 'wd-browser' as SurfaceId)).toBe(true);
    expect(hitMatchesSurfaceId(vwHit, 'pane::7::vw-pane:7:right::' as SurfaceId)).toBe(true);
    expect(hitMatchesSurfaceId(vwHit, 'vw-pane:7:right' as SurfaceId)).toBe(true);
  });

  test('canonical surface id equals surfaceKey(surfaceAddress) when reversible', () => {
    const inputHit: HitTarget = { kind: 'input', inputId: 'chat-main' };
    const modalHit: HitTarget = { kind: 'modal-button', modalId: 'approval-1' as SurfaceId, buttonId: 'ok' };

    expect(surfaceAddressFromHit(inputHit)).toEqual({ kind: 'input', inputId: 'chat-main' });
    expect(surfaceIdFromHit(inputHit)).toBe('input::chat-main');
    expect(surfaceAddressFromHit(modalHit)).toEqual({ kind: 'modal', modalId: 'approval-1' });
    expect(surfaceIdFromHit(modalHit)).toBe('modal::approval-1');
  });

  test('surfaceKindFromHit projects hits into the canonical surface vocabulary', () => {
    expect(surfaceKindFromHit({ kind: 'vw-pane-body', windowId: '7', paneId: 'editor' })).toBe('pane');
    expect(surfaceKindFromHit({ kind: 'input', inputId: 'chat-main' })).toBe('input');
    expect(surfaceKindFromHit({ kind: 'modal-body', modalId: 'approval-1' as SurfaceId })).toBe('modal');
    expect(surfaceKindFromHit({ kind: 'modal-title', modalId: 'approval-1' as SurfaceId })).toBe('modal');
    expect(surfaceKindFromHit({ kind: 'pill', name: 'model' })).toBeNull();
    expect(surfaceKindFromHit({ kind: 'pane-body', paneId: 'wd-browser' })).toBeNull();
  });

  test('unexpected runtime hit kinds do not crash surface matching', () => {
    const malformedHit = { kind: 'unknown' } as unknown as HitTarget;

    expect(surfaceIdFromHit(malformedHit)).toBeNull();
    expect(legacySurfaceIdAliasesFromHit(malformedHit)).toEqual([]);
    expect(hitMatchesSurfaceId(malformedHit, 'wd-browser' as SurfaceId)).toBe(true);
  });
});
