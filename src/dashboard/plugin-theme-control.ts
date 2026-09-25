import type { ThemeTokens } from '../theme/tokens.js';
import type { HostHooks } from '../plugins/core/host.js';

export interface DashboardPluginThemeControlDeps {
  getDashboardThemeConfig: () => unknown;
  setDashboardThemeActive: (id: string) => void;
  currentThemeTokens: () => ThemeTokens;
  getThemeContributions: () => unknown[];
  requestDashboardRender: () => void;
}

export function createDashboardPluginThemeControl(
  deps: DashboardPluginThemeControlDeps,
): NonNullable<HostHooks['themeControl']> {
  return {
    getState: () => {
      const raw = deps.getDashboardThemeConfig();
      const active = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).active ?? null
        : null;
      return {
        active,
        tokens: deps.currentThemeTokens(),
        contributions: deps.getThemeContributions(),
      };
    },
    setActive: (id: string) => {
      deps.setDashboardThemeActive(id);
      deps.requestDashboardRender();
      return { active: id };
    },
  };
}
