import type { PluginTaskContribution } from '../plugins/core/manifest.js';
import type { CronScan } from './routines.js';

export type RoutineDeclarationComparison =
  | { readonly kind: 'same' }
  | { readonly kind: 'different'; readonly bots: readonly string[] }
  | { readonly kind: 'unmeasured'; readonly why: string };

/**
 * Compare the existing crontab declaration with plugin task declarations.
 * This is intentionally pure and does not execute either declaration.
 */
export function compareRoutineDeclarations(
  cron: CronScan,
  tasks: readonly PluginTaskContribution[],
  hostBots: readonly string[],
): RoutineDeclarationComparison {
  if (cron.kind === 'unmeasured') return { kind: 'unmeasured', why: cron.why };

  const cronRoutines = new Map<string, string>();
  for (const job of cron.read.jobs) {
    if (job.kind === 'routine' && job.personaId !== undefined) {
      cronRoutines.set(job.personaId, `scripts/botlab/${job.script}`);
    }
  }

  const pluginRoutines = new Map<string, string>();
  for (const task of tasks) {
    const bot = task.args?.[1];
    if (task.command === 'bun' && task.args?.[0] === 'scripts/botlab/bot-routine.ts' && bot !== undefined) {
      pluginRoutines.set(bot, task.args[0]);
    }
  }

  const different = [...new Set(hostBots)]
    .filter((bot) => cronRoutines.get(bot) !== pluginRoutines.get(bot))
    .sort();

  return different.length === 0 ? { kind: 'same' } : { kind: 'different', bots: different };
}
