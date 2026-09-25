// ── PFC-S4 follow-up: /research slash executor ──
//
// Thin adapter between the dashboard chat-input loop and the pure
// resolveResearchSlash decision function. Takes a parsed
// ResearchSlashInput + a dispatchToolByName callback, resolves the
// outcome, executes the command chain, and returns a flat list of
// operator-facing lines. Errors surface as message strings — never
// throws — so the outer slash loop stays simple.

import { resolveResearchSlash, type ResearchSlashInput } from './slash.js';

export type ToolDispatch = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export interface ResearchSlashExecResult {
  lines: string[];
  success: boolean;
}

export async function executeResearchSlash(
  input: ResearchSlashInput,
  dispatch: ToolDispatch,
): Promise<ResearchSlashExecResult> {
  const outcome = resolveResearchSlash(input);
  const lines: string[] = [`  ${outcome.message}`];

  if (outcome.kind !== 'dispatch' || !outcome.commands) {
    return { lines, success: outcome.kind !== 'error' };
  }

  for (const cmd of outcome.commands) {
    try {
      const result = await dispatch(cmd.tool, cmd.input);
      const summary = summariseResult(cmd.tool, result);
      if (summary) lines.push(`  ↳ ${cmd.tool}: ${summary}`);
    } catch (err) {
      lines.push(`  ✗ ${cmd.tool} failed: ${(err as Error).message}`);
      return { lines, success: false };
    }
  }

  return { lines, success: true };
}

function summariseResult(tool: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  switch (tool) {
    case 'research_plan': {
      const parts: string[] = [];
      if (r.mission) parts.push(`mission="${truncate(String(r.mission), 60)}"`);
      if (typeof r.queue_pending_count === 'number') parts.push(`${r.queue_pending_count} pending`);
      if (typeof r.wins_count === 'number' && r.wins_count > 0) parts.push(`${r.wins_count} wins`);
      if (r.has_summary) parts.push('summary ✓');
      if (r.goals && Array.isArray(r.goals)) parts.push(`${r.goals.length} goals`);
      return parts.join(' · ');
    }
    case 'budget': {
      if (r.budget_line) return String(r.budget_line);
      return '';
    }
    case 'termination_check': {
      const should = r.should_terminate ? 'should_terminate=true' : 'should_terminate=false';
      const sat = Array.isArray(r.satisfied) ? ` satisfied:${r.satisfied.length}` : '';
      const unsat = Array.isArray(r.unsatisfied) ? ` unsatisfied:${r.unsatisfied.length}` : '';
      return `${should}${sat}${unsat}`;
    }
    case 'enter_auto_mode':
    case 'exit_auto_mode': {
      const out = typeof r.output === 'string' ? truncate(r.output, 160) : '';
      return out;
    }
    default: {
      if (typeof r.output === 'string') return truncate(r.output, 120);
      return '';
    }
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ── Argv parsing — turn "/research start <slug> --mission ..." tokens
// into a ResearchSlashInput. Parser stays permissive: unknown flags are
// ignored, positional args after the action are the goal_slug.

export interface ParseOpts {
  /** Starting tokens — typically the dashboard's `args` array after the
   *  leading `/research`. First element is the subcommand name. */
  tokens: string[];
}

export function parseResearchArgs(opts: ParseOpts): ResearchSlashInput | { error: string } {
  const [action, ...rest] = opts.tokens;
  if (!action) return { error: 'usage: /research <start|status|stop|tail|replan> [goal_slug] [flags]' };
  const lowered = action.toLowerCase();
  if (!isResearchAction(lowered)) {
    return { error: `/research: unknown action '${action}' (expected start|status|stop|tail|replan)` };
  }

  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        const key = tok.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = 'true';
        }
      }
    } else {
      positional.push(tok);
    }
  }

  const input: ResearchSlashInput = { action: lowered };
  const slug = positional[0] ?? flags.goal_slug ?? flags.slug;
  if (slug) input.goal_slug = slug;

  if (flags.mission) input.mission = flags.mission;
  if (flags.plan) input.plan = flags.plan;
  if (flags.summary) input.summary = flags.summary;
  if (flags.reason && isExitReason(flags.reason)) input.reason = flags.reason;
  if (flags.max_turns) {
    const n = Number(flags.max_turns);
    if (Number.isFinite(n)) input.max_turns = n;
  }
  if (flags.budget) {
    try { input.budget = JSON.parse(flags.budget); }
    catch { return { error: `/research: --budget expects JSON (got: ${flags.budget})` }; }
  }
  if (flags.termination) {
    try { input.termination = JSON.parse(flags.termination); }
    catch { return { error: `/research: --termination expects JSON (got: ${flags.termination})` }; }
  }

  return input;
}

function isResearchAction(s: string): s is ResearchSlashInput['action'] {
  return s === 'start' || s === 'status' || s === 'stop' || s === 'tail' || s === 'replan';
}

function isExitReason(s: string): s is NonNullable<ResearchSlashInput['reason']> {
  return s === 'manual' || s === 'termination_met' || s === 'budget_tripped' || s === 'max_turns' || s === 'error';
}
