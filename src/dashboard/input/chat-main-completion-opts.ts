import type { ChatMainTextInputBaseOpts } from './chat-main-turn.js';
import { filterInputMatches, rankInputMatchesByPrefix } from '../../input/query-match.js';

export interface DashboardVisibleSkillEntry {
  name: string;
  description: string;
}

export interface DashboardPluginActivationEntry {
  plugin: {
    name: string;
    description: string;
    version: string;
  };
  source: string;
}

export interface DashboardContextDropEntry {
  id: number | string;
  token: string;
  filename: string;
}

export type DashboardChatMainCompletionOpts = Pick<
  ChatMainTextInputBaseOpts,
  'getArgSuggestions' | 'getSkillCandidates'
>;

export function createDashboardChatMainCompletionOpts(
  deps: {
    getVisibleSkills: () => DashboardVisibleSkillEntry[];
    listPlugins: () => DashboardPluginActivationEntry[];
    listContextDrops: () => DashboardContextDropEntry[];
  },
): DashboardChatMainCompletionOpts {
  return {
    getArgSuggestions: async (cmdName, priorArgs) => {
      if (cmdName === 'plugin' || cmdName === 'plugins' || cmdName === 'p') {
        if (priorArgs.length === 1 && (priorArgs[0] === 'activate' || priorArgs[0] === 'a'
            || priorArgs[0] === 'reload' || priorArgs[0] === 'r')) {
          return deps.listPlugins().map((entry) => ({
            value: entry.plugin.name,
            description: `${entry.plugin.description} (v${entry.plugin.version}, ${entry.source})`,
          }));
        }
      }
      if ((cmdName === 'context' || cmdName === 'ctx') && priorArgs[0] === 'drop') {
        return deps.listContextDrops().map((attachment) => ({
          value: String(attachment.id),
          description: `${attachment.token} ${attachment.filename}`,
        }));
      }
      if (cmdName === 'run-skill' || cmdName === 'rs' || cmdName === 'run') {
        if (priorArgs.length === 0) {
          return deps.getVisibleSkills().map((entry) => ({
            value: entry.name,
            description: entry.description.split('\n')[0] ?? '',
          }));
        }
      }
      return [];
    },
    getSkillCandidates: async (prefix: string) => {
      const ranked = rankInputMatchesByPrefix(
        filterInputMatches(
          deps.getVisibleSkills(),
          prefix,
          (entry) => `${entry.name}\n${entry.description}`,
          'substring',
        ),
        prefix,
        (entry) => entry.name,
        (a, b) => a.name.localeCompare(b.name),
      );
      return ranked.slice(0, 15).map((entry) => ({
        name: entry.name,
        description: entry.description.split('\n')[0] ?? '',
      }));
    },
  };
}
