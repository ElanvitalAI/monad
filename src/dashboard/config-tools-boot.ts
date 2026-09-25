import type {
  ConfigGetter,
  ConfigKey,
  ConfigSetApprover,
  ConfigSetter,
} from '../skills/tools/dashboard-config.js';
import type { PreviewSource } from '../workspace-types.js';

export interface DashboardConfigToolsBootDeps {
  initDashboardConfigTools: (
    getter: ConfigGetter,
    setter: ConfigSetter,
    approver?: ConfigSetApprover,
  ) => void;
  approver: ConfigSetApprover;
  getChatOnlyMode: () => boolean;
  applyChatOnlyMode: (enabled: boolean) => void;
  getUserConfig: () => Record<string, any>;
  saveUserConfig: (cfg: Record<string, any>) => void;
  getPreviewSource: () => PreviewSource;
  applyPreviewSource: (source: PreviewSource) => void;
  getWorkingDirShowHidden: () => boolean;
  applyWorkingDirShowHidden: (enabled: boolean) => void;
  getWorkingDirSortMode: () => string;
  applyWorkingDirSortMode: (mode: string) => void;
  afterThemeActiveSaved: () => void;
}

export function bootDashboardConfigTools(
  deps: DashboardConfigToolsBootDeps,
): void {
  deps.initDashboardConfigTools(
    (key: ConfigKey): unknown => {
      switch (key) {
        case 'dashboard.chatOnlyMode': return deps.getChatOnlyMode();
        case 'dashboard.promptBank.budgetTokens': return deps.getUserConfig().dashboard.promptBank.budgetTokens;
        case 'dashboard.promptBank.dashboardTurns': return deps.getUserConfig().dashboard.promptBank.dashboardTurns;
        case 'dashboard.promptBank.enabled': return deps.getUserConfig().dashboard.promptBank.enabled;
        case 'dashboard.promptBank.limit': return deps.getUserConfig().dashboard.promptBank.limit;
        case 'dashboard.promptBank.record': return deps.getUserConfig().dashboard.promptBank.record;
        case 'dashboard.promptBank.skillRuns': return deps.getUserConfig().dashboard.promptBank.skillRuns;
        case 'dashboard.theme.active': {
          const raw = deps.getUserConfig().dashboard.theme;
          return raw && typeof raw === 'object' && 'active' in raw ? (raw as { active: string }).active : 'default';
        }
        case 'input.maxLines': return deps.getUserConfig().input?.maxLines ?? 4;
        case 'preview.source': return deps.getPreviewSource();
        case 'workingDir.showHidden': return deps.getWorkingDirShowHidden();
        case 'workingDir.sortMode': return deps.getWorkingDirSortMode();
      }
    },
    async (key: ConfigKey, value: unknown): Promise<void> => {
      switch (key) {
        case 'dashboard.chatOnlyMode':
          deps.applyChatOnlyMode(!!value);
          return;
        case 'dashboard.promptBank.budgetTokens': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, budgetTokens: value as number };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.promptBank.dashboardTurns': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, dashboardTurns: !!value };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.promptBank.enabled': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, enabled: !!value };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.promptBank.limit': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, limit: value as number };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.promptBank.record': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, record: !!value };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.promptBank.skillRuns': {
          const cfg = deps.getUserConfig();
          cfg.dashboard.promptBank = { ...cfg.dashboard.promptBank, skillRuns: !!value };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'dashboard.theme.active': {
          const cfg = deps.getUserConfig();
          cfg.dashboard = cfg.dashboard ?? {};
          cfg.dashboard.theme = { ...(cfg.dashboard.theme as object ?? {}), active: String(value) } as never;
          deps.saveUserConfig(cfg);
          deps.afterThemeActiveSaved();
          return;
        }
        case 'input.maxLines': {
          const cfg = deps.getUserConfig();
          cfg.input = { ...(cfg.input ?? {}), maxLines: value as number };
          deps.saveUserConfig(cfg);
          return;
        }
        case 'preview.source':
          deps.applyPreviewSource(value as PreviewSource);
          return;
        case 'workingDir.showHidden':
          deps.applyWorkingDirShowHidden(!!value);
          return;
        case 'workingDir.sortMode':
          deps.applyWorkingDirSortMode(String(value));
          return;
      }
    },
    deps.approver,
  );
}
