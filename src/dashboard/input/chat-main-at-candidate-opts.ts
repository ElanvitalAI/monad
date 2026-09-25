import type { ChatMainTextInputBaseOpts } from './chat-main-turn.js';

export interface DashboardChatMainAtEntry {
  name: string;
  absPath: string;
  isDir: boolean;
  size?: number;
}

export interface DashboardChatMainAtResult {
  label: string;
  absPath: string;
  isDir: boolean;
  icon: string;
  hint: string;
}

export type DashboardChatMainAtCandidateOpts = Pick<
  ChatMainTextInputBaseOpts,
  'onAtCandidates'
>;

export function createDashboardChatMainAtCandidateOpts(
  deps: {
    baseCwd: () => string;
    readRootEntries: (cwd: string) => DashboardChatMainAtEntry[];
    listDirEntries: (dir: string, showHidden: boolean) => DashboardChatMainAtEntry[];
    splitAtPrefix: (prefix: string, cwd: string) => { dir: string; partial: string };
    searchIndex: (cwd: string, prefix: string, limit: number) => Array<{ path: string }>;
    absolutize: (path: string, cwd: string) => string;
    formatEntry: (entry: DashboardChatMainAtEntry, label: string) => DashboardChatMainAtResult;
    formatSearchResult: (result: { path: string }, cwd: string) => DashboardChatMainAtResult;
  },
): DashboardChatMainAtCandidateOpts {
  return {
    onAtCandidates: async (prefix: string) => {
      const baseCwd = deps.baseCwd();

      if (prefix === '') {
        return deps.readRootEntries(baseCwd)
          .slice(0, 15)
          .map((entry) => deps.formatEntry(entry, entry.isDir ? `${entry.name}/` : entry.name));
      }

      if (prefix.endsWith('/')) {
        let split: { dir: string; partial: string };
        try {
          split = deps.splitAtPrefix(prefix, baseCwd);
        } catch {
          return [];
        }
        let entries: DashboardChatMainAtEntry[];
        try {
          entries = deps.listDirEntries(split.dir, split.partial.startsWith('.'));
        } catch {
          return [];
        }
        return entries
          .slice(0, 15)
          .map((entry) => deps.formatEntry(entry, entry.isDir ? `${prefix}${entry.name}/` : `${prefix}${entry.name}`));
      }

      return deps.searchIndex(baseCwd, prefix, 15)
        .map((result) => deps.formatSearchResult(result, baseCwd));
    },
  };
}
