import { describe, expect, mock, test } from 'bun:test';

import { createDashboardPluginThemeControl } from '../src/dashboard/plugin-theme-control.js';

describe('dashboard plugin theme control', () => {
  test('getState returns active theme, live tokens, and contributed themes', () => {
    const control = createDashboardPluginThemeControl({
      getDashboardThemeConfig: () => ({ active: 'rose-pine-dawn' }),
      setDashboardThemeActive: mock((_id: string) => {}),
      currentThemeTokens: () => ({ pane: { border: 'pink' } } as never),
      getThemeContributions: () => [{ id: 'plugin-theme' }],
      requestDashboardRender: mock(() => {}),
    });

    expect(control.getState()).toEqual({
      active: 'rose-pine-dawn',
      tokens: { pane: { border: 'pink' } },
      contributions: [{ id: 'plugin-theme' }],
    });
  });

  test('setActive updates config and requests rerender', () => {
    const setDashboardThemeActive = mock((_id: string) => {});
    const requestDashboardRender = mock(() => {});
    const control = createDashboardPluginThemeControl({
      getDashboardThemeConfig: () => ({}),
      setDashboardThemeActive,
      currentThemeTokens: () => ({} as never),
      getThemeContributions: () => [],
      requestDashboardRender,
    });

    expect(control.setActive('catppuccin-latte')).toEqual({ active: 'catppuccin-latte' });
    expect(setDashboardThemeActive).toHaveBeenCalledWith('catppuccin-latte');
    expect(requestDashboardRender).toHaveBeenCalled();
  });
});
