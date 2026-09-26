import { parseBotlabCron, sortJobs } from '../../src/bots/routines.js';
import { readCrontab } from '../../src/bots/screen-probe.js';
import type { CronScan } from '../../src/bots/routines.js';
import type { ElanousPlugin, SlashCommand } from '../../src/plugins/core/types.js';

export const BOTLAB_SCHEDULE_COMMAND = 'botlab-schedules';

export function renderBotlabCron(scan: CronScan): string {
  if (scan.kind === 'unmeasured') return `Botlab schedules: ${scan.why}`;
  const jobs = sortJobs(scan.read.jobs);
  const unparsed = scan.read.unparsed.length;
  if (jobs.length === 0 && unparsed === 0) return 'Botlab schedules: measured; no botlab schedules found.';
  if (jobs.length === 0) return `Botlab schedules: measured; 0 parsed schedules; ${unparsed} botlab line(s) could not be parsed.`;
  const listed = jobs.map((job) => `${job.label}${job.personaId ? ` (${job.personaId})` : ''} — ${job.when}`);
  const unparsedNote = unparsed === 0 ? '' : `; ${unparsed} botlab line(s) could not be parsed`;
  return `Botlab schedules: ${listed.join('; ')}${unparsedNote}`;
}

const slashCommands: SlashCommand[] = [{
  name: BOTLAB_SCHEDULE_COMMAND,
  description: 'Read and summarize the local botlab crontab schedules.',
  handler: async (_args, ctx) => {
    const crontab = await readCrontab(null);
    ctx.log(renderBotlabCron(parseBotlabCron(crontab)));
  },
}];

const botlab: ElanousPlugin = {
  name: 'botlab',
  version: '0.1.0',
  description: 'Read-only schedule surface for existing botlab automation.',
  initialState: () => ({}),
  panes: {},
  slashCommands,
};

export default botlab;
