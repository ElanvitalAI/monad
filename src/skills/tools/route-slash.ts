// H6 P3 Bundle 1 · /route slash command.
//
// Bundle 1 scope (recommend-only):
//   /route <task>              — dry-run decide + print
//   /route test <task>          — decide + full candidate list + trace
//   /route explain              — last decision trace
//   /route help                 — usage
//
// Bundle 2 adds `lock` · `unlock` · `default` · `bypass-throttle` ·
// `bypass-clear` (per-PLAN §8 split). Keeping slash surface minimal
// here matches budget tracker's phased rollout (Bundle 1 status +
// history · Bundle 2 set + forecast).

import type { SlashExecuteRequest, SlashExecuteResult } from './dashboard-slash.js';
import {
  dispatchPolicyExplain,
  dispatchPolicyDecide,
} from './route.js';

export interface RouteSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeRouteSlash(
  req: SlashExecuteRequest,
): Promise<RouteSlashResult | null> {
  if (req.name !== 'route') return null;
  const [sub, ...rest] = req.args;
  const norm = (sub ?? '').toLowerCase();
  try {
    switch (norm) {
      case '':
        return helpOutput();
      case 'help':
      case '?':
        return helpOutput();
      case 'test':
        return await testAction(rest.join(' '));
      case 'explain':
        return await explainAction(rest.join(' '));
      default:
        // Treat any free-form text as a task for `/route <task>`.
        return await decideAction([sub!, ...rest].join(' '));
    }
  } catch (err) {
    return {
      ok: false,
      name: req.name,
      args: req.args,
      logLines: [
        `/route ${norm || ''}: ${err instanceof Error ? err.message : String(err)}`,
      ],
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────

async function decideAction(task: string): Promise<RouteSlashResult> {
  if (!task.trim()) {
    return helpOutput();
  }
  const result = await dispatchPolicyDecide({ task });
  return {
    ok: !result.isError,
    name: 'route',
    args: [task],
    logLines: splitLines(result.output),
    ...(result.isError ? { message: result.output } : {}),
  };
}

async function testAction(task: string): Promise<RouteSlashResult> {
  if (!task.trim()) {
    return {
      ok: false,
      name: 'route',
      args: ['test'],
      logLines: [
        'usage: /route test <task>',
        'dry-run decide + full candidate list + step-by-step trace',
      ],
      message: 'missing task',
    };
  }
  const decide = await dispatchPolicyDecide({ task });
  const explain = await dispatchPolicyExplain({ task });
  const lines: string[] = [];
  lines.push(...splitLines(decide.output));
  lines.push('');
  lines.push('— trace —');
  lines.push(...splitLines(explain.output));
  const alts = (decide.metadata as { alternatives?: { brand: string; model?: string; availability: string; costTier?: string; contextWindow?: number }[] }).alternatives ?? [];
  if (alts.length > 0) {
    lines.push('');
    lines.push('— alternatives —');
    for (const a of alts) {
      const label = a.model ? `${a.brand}/${a.model}` : a.brand;
      const extras: string[] = [];
      if (a.costTier) extras.push(`tier=${a.costTier}`);
      if (a.contextWindow) extras.push(`ctx=${a.contextWindow}`);
      lines.push(`  ${label}  availability=${a.availability}${extras.length ? ' · ' + extras.join(' ') : ''}`);
    }
  }
  return {
    ok: !decide.isError,
    name: 'route',
    args: ['test', task],
    logLines: lines,
    ...(decide.isError ? { message: decide.output } : {}),
  };
}

async function explainAction(task: string): Promise<RouteSlashResult> {
  const result = await dispatchPolicyExplain(task.trim() ? { task } : {});
  return {
    ok: !result.isError,
    name: 'route',
    args: task.trim() ? ['explain', task] : ['explain'],
    logLines: splitLines(result.output),
    ...(result.isError ? { message: result.output } : {}),
  };
}

function helpOutput(): RouteSlashResult {
  return {
    ok: true,
    name: 'route',
    args: [],
    logLines: [
      '/route — budget-aware policy router (H6 P3 · Bundle 1 recommend-only)',
      '  /route <task>          dry-run decide + print (brand/model + reason)',
      '  /route test <task>     decide + full alternatives + rule trace',
      '  /route explain [task]  last trace (or fresh decide for <task>)',
      '  /route help            this text',
      '',
      '  Bundle 2 (planned): lock · unlock · default · bypass-throttle · bypass-clear',
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function splitLines(s: string): string[] {
  return s.split('\n').filter((l) => l.length > 0);
}
