import { describe, expect, test } from 'bun:test';
import { createCompactSurfaceEffects } from '../src/dashboard/compact-surface-effects.js';

describe('createCompactSurfaceEffects', () => {
  test('routes chat-only lifecycle through hud/debug helpers', () => {
    const calls: string[] = [];
    const effects = createCompactSurfaceEffects({
      setChatModeHud: (enabled) => calls.push(`hud:${enabled ? 'on' : 'off'}`),
      pushDebugLine: (line) => calls.push(line),
      resetChatScroll: () => calls.push('scroll'),
      restoreStarterPanes: () => calls.push('restore'),
      resetDashboardViewsConfig: () => calls.push('reset'),
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
    });

    effects.onChatOnlyEnabled();
    effects.onChatOnlyDisabled();

    expect(calls).toEqual([
      'hud:on',
      'muted:  chat-only layout enabled from dock menu.',
      'scroll',
      'hud:off',
      'muted:  chat-only layout disabled from dock menu.',
      'scroll',
    ]);
  });

  test('routes restore and reset actions through shared debug hooks', () => {
    const calls: string[] = [];
    const effects = createCompactSurfaceEffects({
      setChatModeHud: (enabled) => calls.push(`hud:${enabled ? 'on' : 'off'}`),
      pushDebugLine: (line) => calls.push(line),
      resetChatScroll: () => calls.push('scroll'),
      restoreStarterPanes: () => calls.push('restore'),
      resetDashboardViewsConfig: () => calls.push('reset'),
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
    });

    effects.restoreStarterPanes();
    effects.resetDashboardViewsConfig();

    expect(calls).toEqual([
      'restore',
      'muted:  current starter panes restored from view picker',
      'scroll',
      'reset',
      'success:  dashboard view config reset to built-in defaults',
      'scroll',
    ]);
  });
});
