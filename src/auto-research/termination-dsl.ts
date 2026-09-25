// ── PFC-S3 P4: termination DSL evaluator ──
//
// JSON AST of termination rules. Composable (`and` / `or`) so the
// operator can express "all questions answered AND ≥ 3 sources AND
// summary written AND budget > 10% remaining" declaratively.
//
// Each rule evaluates against a TerminationContext carrying the
// vault + budget + goalRoot. Evaluation is async because `custom`
// rules spawn a shell command (same JSON stdin/stdout contract as
// PX-4 mission evaluator, but kept standalone so mission / research
// concerns stay decoupled).

import { requirePosixShellCommand } from '../platform/default-shell.js';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObsidianVault } from './obsidian-bridge.js';
import type { BudgetMeter } from './budget-meter.js';

export type TerminationRule =
  | { kind: 'all_questions_answered'; queuePath: string }
  | { kind: 'min_sources'; n: number; sourcesPath: string }
  | { kind: 'summary_written'; path: string; minChars?: number }
  | { kind: 'budget_remaining_min'; ratio: number }
  | { kind: 'and'; rules: TerminationRule[] }
  | { kind: 'or'; rules: TerminationRule[] }
  | { kind: 'custom'; command: string; timeoutMs?: number };

export interface TerminationContext {
  vault: ObsidianVault;
  budget: BudgetMeter;
  /** Absolute path to the goal directory — paths in rules that aren't
   *  absolute are resolved relative to this. */
  goalRoot: string;
  /** Optional abort signal (e.g. session shutdown). */
  abortSignal?: AbortSignal;
}

export interface TerminationOutcome {
  shouldTerminate: boolean;
  satisfied: TerminationRule[];
  unsatisfied: TerminationRule[];
  diagnostics: Record<string, string>;
}

export async function evaluateTermination(
  rule: TerminationRule,
  ctx: TerminationContext,
): Promise<TerminationOutcome> {
  const satisfied: TerminationRule[] = [];
  const unsatisfied: TerminationRule[] = [];
  const diagnostics: Record<string, string> = {};
  const ok = await evalRule(rule, ctx, satisfied, unsatisfied, diagnostics);
  return { shouldTerminate: ok, satisfied, unsatisfied, diagnostics };
}

async function evalRule(
  rule: TerminationRule,
  ctx: TerminationContext,
  satisfied: TerminationRule[],
  unsatisfied: TerminationRule[],
  diagnostics: Record<string, string>,
): Promise<boolean> {
  switch (rule.kind) {
    case 'all_questions_answered': return check(
      rule, satisfied, unsatisfied, diagnostics,
      () => allQuestionsAnswered(rule.queuePath, ctx),
    );
    case 'min_sources': return check(
      rule, satisfied, unsatisfied, diagnostics,
      () => minSources(rule.n, rule.sourcesPath, ctx),
    );
    case 'summary_written': return check(
      rule, satisfied, unsatisfied, diagnostics,
      () => summaryWritten(rule.path, rule.minChars ?? 0, ctx),
    );
    case 'budget_remaining_min': return check(
      rule, satisfied, unsatisfied, diagnostics,
      () => budgetRemainingMin(rule.ratio, ctx),
    );
    case 'and': {
      let all = true;
      for (const r of rule.rules) {
        const ok = await evalRule(r, ctx, satisfied, unsatisfied, diagnostics);
        if (!ok) all = false;
      }
      (all ? satisfied : unsatisfied).push(rule);
      return all;
    }
    case 'or': {
      let any = false;
      for (const r of rule.rules) {
        const ok = await evalRule(r, ctx, satisfied, unsatisfied, diagnostics);
        if (ok) any = true;
      }
      (any ? satisfied : unsatisfied).push(rule);
      return any;
    }
    case 'custom': return check(
      rule, satisfied, unsatisfied, diagnostics,
      () => runCustomShell(rule, ctx),
    );
  }
}

type Checker = () => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };

async function check(
  rule: TerminationRule,
  satisfied: TerminationRule[],
  unsatisfied: TerminationRule[],
  diagnostics: Record<string, string>,
  run: Checker,
): Promise<boolean> {
  try {
    const res = await run();
    if (res.reason) diagnostics[rule.kind] = res.reason;
    (res.ok ? satisfied : unsatisfied).push(rule);
    return res.ok;
  } catch (err) {
    diagnostics[rule.kind] = `error: ${(err as Error).message}`;
    unsatisfied.push(rule);
    return false;
  }
}

// ── Per-rule implementations ───────────────────────────────────────────

function resolvePath(path: string, ctx: TerminationContext): string {
  if (path.startsWith('/')) return path;
  return join(ctx.goalRoot, path);
}

function allQuestionsAnswered(relPath: string, ctx: TerminationContext): { ok: boolean; reason: string } {
  const path = resolvePath(relPath, ctx);
  if (!existsSync(path)) return { ok: true, reason: 'queue file absent — treated as empty' };
  const raw = readFileSync(path, 'utf-8');
  const pending = raw.split('\n').filter(l => /^\s*-\s*\[\s\]/.test(l)).length;
  return {
    ok: pending === 0,
    reason: pending === 0 ? 'queue empty' : `${pending} pending`,
  };
}

function minSources(n: number, relPath: string, ctx: TerminationContext): { ok: boolean; reason: string } {
  const path = resolvePath(relPath, ctx);
  if (!existsSync(path)) return { ok: false, reason: 'sources file absent' };
  const raw = readFileSync(path, 'utf-8');
  const count = raw.split('\n').filter(l => /^\s*-\s+/.test(l) || /https?:\/\//.test(l)).length;
  return { ok: count >= n, reason: `${count}/${n} sources` };
}

function summaryWritten(relPath: string, minChars: number, ctx: TerminationContext): { ok: boolean; reason: string } {
  const path = resolvePath(relPath, ctx);
  if (!existsSync(path)) return { ok: false, reason: 'summary missing' };
  const raw = readFileSync(path, 'utf-8');
  return {
    ok: raw.trim().length >= minChars,
    reason: `${raw.trim().length} chars (min ${minChars})`,
  };
}

function budgetRemainingMin(ratio: number, ctx: TerminationContext): { ok: boolean; reason: string } {
  const snap = ctx.budget.snapshot();
  const axesWithCap = Object.entries(snap.remaining);
  if (axesWithCap.length === 0) return { ok: true, reason: 'unlimited budget' };
  const fails = axesWithCap.filter(([, rem]) => {
    // cap = used + rem (remaining)
    // We cannot easily recover cap here from snapshot; fetch from
    // BudgetMeter via rawUsage + remaining sum.
    return false;
  });
  // Recompute properly — ratio over cap.
  for (const [axis, rem] of axesWithCap) {
    const used = (snap as unknown as Record<string, number>)[axis];
    const cap = (used ?? 0) + (rem ?? 0);
    if (cap === 0) continue;
    if ((rem ?? 0) / cap < ratio) {
      return { ok: false, reason: `${axis} remaining ${((rem ?? 0) / cap * 100).toFixed(1)}% < ${(ratio * 100).toFixed(0)}%` };
    }
  }
  return { ok: true, reason: 'all axes ≥ threshold' };
}

// ── Custom shell evaluator ─────────────────────────────────────────────

async function runCustomShell(
  rule: Extract<TerminationRule, { kind: 'custom' }>,
  ctx: TerminationContext,
): Promise<{ ok: boolean; reason: string }> {
  const timeoutMs = rule.timeoutMs ?? 60_000;
  return new Promise(resolve => {
    let shell: string;
    try { shell = requirePosixShellCommand('/bin/sh'); }
    catch (error) { resolve({ ok: false, reason: (error as Error).message }); return; }
    const child = spawn(shell, ['-c', rule.command], {
      cwd: ctx.goalRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = () => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 250);
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    ctx.abortSignal?.addEventListener('abort', () => { kill(); }, { once: true });
    child.stdout?.on('data', d => { stdout += String(d); });
    child.stderr?.on('data', d => { stderr += String(d); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) resolve({ ok: false, reason: 'timeout' });
      else resolve({
        ok: (code ?? 1) === 0,
        reason: `exit ${code ?? 'null'}${stderr.trim() ? ' ' + stderr.trim().slice(0, 80) : ''}`,
      });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `spawn error: ${err.message}` });
    });
    try { child.stdin?.end(); } catch { /* ignore */ }
  });
}
