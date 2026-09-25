/**
 * `/task` slash resolver — pure function that maps argv to an output
 * string. Dashboard wires this behind the slash switch (follow-up
 * phase — dashboard.ts is high-conflict; resolver ships alone here).
 */
import { dispatchTaskList } from './runtimes/list.js';
import { dispatchTaskGet } from './runtimes/get.js';
import { dispatchTaskDecompose } from './runtimes/decompose.js';
import { dispatchTaskDecomposeApply } from './runtimes/decompose.js';
import { dispatchTaskDispatch } from './runtimes/dispatch.js';
import { dispatchTaskKill } from './runtimes/kill.js';
import { getToxRuntimeDeps } from './runtime-deps.js';

export interface TaskSlashResult {
  output: string;
  action?: 'noop' | 'refresh' | 'paused' | 'resumed';
}

const SUBCOMMANDS = [
  'list',
  'show',
  'decompose',
  'apply',
  'dispatch',
  'kill',
  'pause',
  'resume',
  'stats',
  'help',
] as const;

export async function resolveTaskSlash(args: string[]): Promise<TaskSlashResult> {
  const sub = args[0]?.toLowerCase() ?? '';

  if (!sub) return overview();
  switch (sub) {
    case 'list': {
      const status = args[1];
      const r = await dispatchTaskList(status ? { status } : {});
      return { output: r.output, action: 'refresh' };
    }
    case 'show': {
      const id = args[1];
      if (!id) return { output: '/task show <taskId>' };
      const r = await dispatchTaskGet({ taskId: id });
      return { output: r.output };
    }
    case 'decompose': {
      // everything after 'decompose' is the objective; strip quotes.
      const raw = args.slice(1).join(' ').trim();
      const objective = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      if (!objective) return { output: '/task decompose "<objective>"' };
      const r = await dispatchTaskDecompose({ objective });
      return { output: r.output };
    }
    case 'apply': {
      const token = args[1];
      if (!token) return { output: '/task apply <applyToken>' };
      const force = args.includes('--force');
      const r = await dispatchTaskDecomposeApply({ applyToken: token, force });
      return { output: r.output, action: 'refresh' };
    }
    case 'dispatch': {
      const r = await dispatchTaskDispatch({});
      return { output: r.output, action: 'refresh' };
    }
    case 'kill': {
      const id = args[1];
      if (!id) return { output: '/task kill <taskId> [--cascade]' };
      const cascade = args.includes('--cascade');
      const r = await dispatchTaskKill({ taskId: id, cascade });
      return { output: r.output, action: 'refresh' };
    }
    case 'pause': {
      const loop = getToxRuntimeDeps().getFeedbackLoop?.() as
        | { pause: (r: 'manual') => void; isPaused: () => boolean }
        | null;
      if (!loop) return { output: 'TOX feedback loop not wired — pause is a no-op' };
      loop.pause('manual');
      return { output: '/task: loop paused (manual)', action: 'paused' };
    }
    case 'resume': {
      const loop = getToxRuntimeDeps().getFeedbackLoop?.() as
        | { resume: () => void }
        | null;
      if (!loop) return { output: 'TOX feedback loop not wired — resume is a no-op' };
      loop.resume();
      return { output: '/task: loop resumed', action: 'resumed' };
    }
    case 'stats':
      return stats();
    case 'help':
      return { output: helpText() };
    default: {
      const suggest = SUBCOMMANDS.filter((s) => s.startsWith(sub)).slice(0, 3);
      const hint = suggest.length > 0 ? ` — did you mean ${suggest.join(' / ')}?` : '';
      return { output: `/task: unknown subcommand '${sub}'${hint}\n${helpText()}` };
    }
  }
}

function overview(): TaskSlashResult {
  const graph = getToxRuntimeDeps().getGraph();
  if (!graph) return { output: 'TOX not initialized — /task help for usage' };
  const counts = graph.countByStatus();
  const countLine =
    `counts: backlog ${counts.backlog} · blocked ${counts.blocked} · ready ${counts.ready} ` +
    `· running ${counts.running} · done ${counts.done} · failed ${counts.failed}`;
  const ready = graph.readySet({ limit: 1 });
  const nextLine = ready.length > 0
    ? `next-ready: ${ready[0]!.id} — "${ready[0]!.title}" [${ready[0]!.surface.kind}]`
    : 'next-ready: (none)';
  const loop = getToxRuntimeDeps().getFeedbackLoop?.() as
    | { isPaused: () => boolean; stats: () => { pausedReason: string | null } }
    | null;
  const loopLine = loop
    ? `loop: ${loop.isPaused() ? 'paused(' + (loop.stats().pausedReason ?? 'unknown') + ')' : 'active'}`
    : 'loop: not wired';
  return {
    output: [`## Task Orchestrator`, countLine, nextLine, loopLine, '', helpText()].join('\n'),
  };
}

function stats(): TaskSlashResult {
  const deps = getToxRuntimeDeps();
  const graph = deps.getGraph();
  if (!graph) return { output: 'TOX not initialized' };
  const loop = deps.getFeedbackLoop?.() as
    | { stats: () => { completedTotal: number; regenerateDepthByGoal: Record<string, number>; paused: boolean; pausedReason: string | null } }
    | null;
  const counts = graph.countByStatus();
  const totalLive = Object.entries(counts).reduce((n, [k, v]) => (k === 'superseded' ? n : n + v), 0);
  const s = loop?.stats();
  const depthLine = s
    ? `regenerate depth: ${Object.entries(s.regenerateDepthByGoal).map(([g, d]) => `${g}=${d}`).join(', ') || '(none)'}`
    : 'regenerate depth: (loop not wired)';
  const pausedLine = s
    ? `paused: ${s.paused}${s.pausedReason ? ' (' + s.pausedReason + ')' : ''}`
    : 'paused: n/a';
  return {
    output: [
      `TaskStats:`,
      `  live tasks: ${totalLive}`,
      `  done: ${counts.done}  failed: ${counts.failed}  cancelled: ${counts.cancelled}`,
      `  completedTotal: ${s?.completedTotal ?? 'n/a'}`,
      `  ${depthLine}`,
      `  ${pausedLine}`,
    ].join('\n'),
  };
}

function helpText(): string {
  return [
    'Subcommands:',
    '  /task                          overview',
    '  /task list [status]            list tasks (optional status filter)',
    '  /task show <id>                detailed task',
    '  /task decompose "<objective>"  propose N subtasks',
    '  /task apply <token> [--force]  commit a proposal',
    '  /task dispatch                 run dispatcher.tick',
    '  /task kill <id> [--cascade]    cancel task(s)',
    '  /task pause | resume           feedback loop control',
    '  /task stats                    counts + depth + paused',
  ].join('\n');
}

export const TASK_SLASH_SUBCOMMANDS = [...SUBCOMMANDS] as const;
