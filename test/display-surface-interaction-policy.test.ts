import { describe, expect, test } from 'bun:test';

import type { ModalSurface } from '../src/display/modal-stack.js';
import {
  isBlockingModalInteractionSurface,
  isEmbeddedOverlayInteractionSurface,
  isWorkspaceInteractionSurface,
  ownsForegroundModalKeyRoute,
  resolveModalInteractionClass,
  resolveModalInteractionPolicy,
} from '../src/display/surface-interaction-policy.js';

function modal(overrides: Partial<ModalSurface> = {}): ModalSurface {
  return {
    id: 'modal:test',
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 10,
    bounds: { row: 1, col: 1, width: 20, height: 6 },
    backgroundInteractionPolicy: 'block',
    windowRole: 'foreground',
    paint: () => '',
    ...overrides,
  };
}

describe('surface interaction policy', () => {
  test('virtual-window tier and host-like chrome infer workspace when explicit class is absent', () => {
    const m = modal({
      tier: 'vw',
      hostChromeProfile: 'hud-status-input-dock',
      windowRole: 'foreground',
    });
    expect(resolveModalInteractionClass(m)).toBe('workspace');
    expect(isWorkspaceInteractionSurface(m)).toBe(true);
    expect(isBlockingModalInteractionSurface(m)).toBe(false);
    expect(ownsForegroundModalKeyRoute(m)).toBe(false);
  });

  test('companion infers embedded overlay when explicit class is absent', () => {
    const m = modal({
      backgroundInteractionPolicy: 'allow',
      windowRole: 'companion',
    });
    expect(resolveModalInteractionClass(m)).toBe('embedded-overlay');
    expect(isEmbeddedOverlayInteractionSurface(m)).toBe(true);
    expect(isBlockingModalInteractionSurface(m)).toBe(false);
    expect(ownsForegroundModalKeyRoute(m)).toBe(false);
  });

  test('foreground block modal infers blocking-modal', () => {
    const m = modal({
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
    });
    expect(resolveModalInteractionClass(m)).toBe('blocking-modal');
    expect(isBlockingModalInteractionSurface(m)).toBe(true);
    expect(ownsForegroundModalKeyRoute(m)).toBe(true);
  });

  test('explicit workspace class wins over modal-like primitives', () => {
    const m = modal({
      interactionClass: 'workspace',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
    });
    const policy = resolveModalInteractionPolicy(m);
    expect(policy.interactionClass).toBe('workspace');
    expect(policy.blocksHostInput).toBe(false);
    expect(policy.participatesInBlockingForegroundViewMode).toBe(false);
    expect(ownsForegroundModalKeyRoute(m)).toBe(false);
  });
});
