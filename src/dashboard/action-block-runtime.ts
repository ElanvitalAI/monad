import { SYNC_MODES } from '../../plugins/sync/types.js';

export interface DashboardActionBlock {
  select?: {
    skills?: string[];
    servers?: string[];
    services?: string[];
  };
  mode?: string;
  run?: 'sync' | 'diff' | string;
}

export interface DashboardActionBlockSyncState {
  allSkillNames: string[];
  // Index-accessed facade (index.ts `sync.selected` is a Proxy over
  // Record<number, Set<string>>, not a fixed tuple). Panes 0/1/2 =
  // skills/servers/services.
  selected: Record<number, Set<string>>;
  modeIdx: number;
}

export interface DashboardActionApplyOutcome {
  applied: string[];
  autoRun: 'sync' | 'diff' | null;
}

export function parseDashboardActionBlock(fullResponse: string): DashboardActionBlock | null {
  const match = fullResponse.match(/```action\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  return JSON.parse(match[1]!);
}

export function applyDashboardActionBlock(
  action: DashboardActionBlock,
  sync: DashboardActionBlockSyncState,
): DashboardActionApplyOutcome {
  const applied: string[] = [];

  if (action.select) {
    if (action.select.skills) {
      sync.selected[0]!.clear();
      const targets = action.select.skills[0] === '*' ? sync.allSkillNames : action.select.skills;
      for (const skill of targets) {
        if (sync.allSkillNames.includes(skill)) sync.selected[0]!.add(skill);
      }
      applied.push(`${sync.selected[0]!.size} skills`);
    }
    if (action.select.servers) {
      sync.selected[1]!.clear();
      for (const server of action.select.servers) sync.selected[1]!.add(server);
      applied.push(`${sync.selected[1]!.size} servers`);
    }
    if (action.select.services) {
      sync.selected[2]!.clear();
      for (const service of action.select.services) sync.selected[2]!.add(service);
      applied.push(`${sync.selected[2]!.size} services`);
    }
  }

  if (action.mode) {
    const idx = SYNC_MODES.findIndex((mode) => mode.id === action.mode);
    if (idx >= 0) {
      sync.modeIdx = idx;
      applied.push(`mode: ${SYNC_MODES[idx]!.label}`);
    }
  }

  const canAutoRun =
    sync.selected[0]!.size > 0 &&
    sync.selected[1]!.size > 0 &&
    sync.selected[2]!.size > 0;

  let autoRun: 'sync' | 'diff' | null = null;
  if (canAutoRun && action.run === 'sync') autoRun = 'sync';
  else if (canAutoRun && action.run === 'diff') autoRun = 'diff';

  return { applied, autoRun };
}
