import { describe, expect, test } from 'bun:test';
import {
  TRANSIENT_OVERLAY_POLICY,
  transientOverlayPathForFamily,
} from '../src/display/transient-overlay-policy.js';

describe('transient-overlay-policy', () => {
  test('locks the allowed authority path for each transient family', () => {
    expect(transientOverlayPathForFamily('tooltip')).toBe('modal-surface');
    expect(transientOverlayPathForFamily('context-menu')).toBe('modal-surface');
    expect(transientOverlayPathForFamily('status-popup')).toBe('modal-surface');
    expect(transientOverlayPathForFamily('drag-overlay')).toBe('overlay-host');
    expect(transientOverlayPathForFamily('chrome')).toBe('chrome-layer');
  });

  test('policy entries carry rationale for docs and source comments', () => {
    expect(TRANSIENT_OVERLAY_POLICY.tooltip.rationale).toContain('DisplayCoordinator');
    expect(TRANSIENT_OVERLAY_POLICY['drag-overlay'].rationale).toContain('main frame');
  });
});
