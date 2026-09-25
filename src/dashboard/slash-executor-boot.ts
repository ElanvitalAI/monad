import type {
  SlashExecuteHandler,
  SlashExecuteRequest,
  SlashExecuteResult,
} from '../skills/tools/dashboard-slash.js';
import type { ImmediateDashboardSlashDeps } from './input/slash-executor.js';

export interface DashboardSlashExecutorBootDeps {
  initDashboardSlashExecutor: (handler: SlashExecuteHandler) => void;
  allowedSlashes: readonly string[];
  executeImmediateDashboardSlash: (
    req: SlashExecuteRequest,
    deps: ImmediateDashboardSlashDeps,
  ) => SlashExecuteResult | null;
  immediateDeps: ImmediateDashboardSlashDeps;
  appendInputPrefix: (text: string) => void;
  pushMutedLine: (line: string) => void;
  pushMutedLines: (lines: string[]) => void;
  draw: () => void;
}

export function bootDashboardSlashExecutor(
  deps: DashboardSlashExecutorBootDeps,
): void {
  deps.initDashboardSlashExecutor(async (req) => {
    if (!deps.allowedSlashes.includes(req.name)) {
      return { ok: false, name: req.name, args: req.args, message: 'blocked by allow-list' };
    }
    const immediate = deps.executeImmediateDashboardSlash(req, deps.immediateDeps);
    if (immediate) {
      deps.pushMutedLines((immediate.logLines ?? []).map(line => `  ${line}`));
      deps.draw();
      return immediate;
    }
    const line = `/${req.name}${req.args.length ? ` ${req.args.join(' ')}` : ''}`;
    deps.appendInputPrefix(`${line} `);
    deps.pushMutedLine(`  → queued slash: ${line}  (press Enter to execute)`);
    deps.draw();
    return {
      ok: true,
      name: req.name,
      args: req.args,
      logLines: [`queued ${line} into input — user confirms with Enter`],
    };
  });
}
