import { describe, expect, test } from 'bun:test';

import {
  resolveLegacyForegroundModalFocusPlan,
  resolveLegacyForegroundModalDemotionTransition,
  resolveLegacyForegroundModalFallbackPane,
  shouldDemoteLegacyInputFocusForForegroundModal,
} from '../src/dashboard/input/foreground-modal-focus.js';

describe('foreground modal focus helpers', () => {
  test('returns preferred pane when it is not input', () => {
    expect(resolveLegacyForegroundModalFallbackPane('preview', 'log', 'browser')).toBe('preview');
  });

  test('falls back to last working pane when preferred is input', () => {
    expect(resolveLegacyForegroundModalFallbackPane('input', 'log', 'browser')).toBe('log');
  });

  test('falls back to first-pane fallback when both preferred and last are input/null', () => {
    expect(resolveLegacyForegroundModalFallbackPane('input', 'input', 'browser')).toBe('browser');
    expect(resolveLegacyForegroundModalFallbackPane(null, null, 'browser')).toBe('browser');
  });

  test('demotion only triggers for legacy input focus', () => {
    expect(shouldDemoteLegacyInputFocusForForegroundModal('input')).toBe(true);
    expect(shouldDemoteLegacyInputFocusForForegroundModal('log')).toBe(false);
  });

  test('demotion transition resolves next pane and reason in one seam', () => {
    expect(resolveLegacyForegroundModalDemotionTransition({
      workingFocus: 'input',
      preferred: 'preview',
      lastWorkingDirPane: 'log',
      fallbackPane: 'browser',
      reason: 'modal-open',
    })).toEqual({
      nextFocus: 'preview',
      reason: 'modal-open',
    });

    expect(resolveLegacyForegroundModalDemotionTransition({
      workingFocus: 'log',
      preferred: 'preview',
      lastWorkingDirPane: 'browser',
      fallbackPane: 'scratch',
      reason: 'modal-open',
    })).toBeNull();
  });

  test('focus plan returns anchor pane and optional demotion together', () => {
    expect(resolveLegacyForegroundModalFocusPlan({
      workingFocus: 'input',
      preferred: 'input',
      lastWorkingDirPane: 'preview',
      fallbackPane: 'browser',
      reason: 'tablet-modal-open',
    })).toEqual({
      anchorPane: 'preview',
      demotionTransition: {
        nextFocus: 'preview',
        reason: 'tablet-modal-open',
      },
    });

    expect(resolveLegacyForegroundModalFocusPlan({
      workingFocus: 'log',
      preferred: 'log',
      lastWorkingDirPane: 'preview',
      fallbackPane: 'browser',
      reason: 'tablet-modal-open',
    })).toEqual({
      anchorPane: 'log',
      demotionTransition: null,
    });
  });
});
