#!/usr/bin/env bun
//
// loop-runner — self-hosting bootstrap loop (Layer 2 stand-in)
// ============================================================
//
// A hand-written OUTER loop that drives monad's own `agent` turn (INNER
// loop) against a goal, verifying "done" with the existing Termination
// DSL, until the goal is objectively complete OR a furnace-guard fires.
//
// This is the bootstrap: the loop's FIRST real job is to build monad's
// native Layer 2 (see 내부 문서 `CONCEPT-self-hosting-loop-2026-07-01` and
// 내부 문서 `RESEARCH-loop-engineering-vs-pfc-dual-loop-2026-07-01` §5).
//
// Dual-loop mapping:
//   Layer 2 (this script) : trigger + iterate + hard-gate + furnace guard
//   Layer 1 (agent turn)  : goal → execute → verify → repeat, per turn
//   Furnace guard         : maxIterations + no-progress andon (codex ext/goal
//                           `blocked` after 3× repeat) — Layer 2 without a
//                           guard = 토큰 화로.
//
// Run:
//   bun run scripts/loop-runner.ts <goal-spec.json>            # DRY (prints, no mutation)
//   bun run scripts/loop-runner.ts <goal-spec.json> --live     # actually invokes the agent
//   bun run scripts/loop-runner.ts <goal-spec.json> --live --max-iterations 6
//
// Goal spec (JSON) — see scripts/goals/termination-presets.goal.json for a live example.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import {
  evaluateTermination,
  type TerminationRule,
  type TerminationContext,
} from '../src/auto-research/termination-dsl.js';
import { ExperimentLedger } from '../src/auto-research/experiment-ledger.js';

// ── Goal spec ──────────────────────────────────────────────────────────

interface GoalSpec {
  /** kebab-case id; used for the `.loop/<slug>/` state dir. */
  slug: string;
  /** conductor goalKind — informational; drives the completion-audit tone. */
  goalKind: 'research' | 'coding' | 'analysis' | 'monitoring' | 'refactor';
  /** the natural-language goal handed to the agent. */
  intake: string;
  /** where custom termination commands run + where progress is measured (default: repo root). */
  workdir?: string;
  /** the objective "done" check — evaluated every iteration. */
  termination: TerminationRule;
  /** hard furnace cap — the loop never exceeds this (default 8). */
  maxIterations?: number;
  /** consecutive no-progress turns → andon stop (default 3, codex pattern). */
  noProgressAndon?: number;
  /** 'persist' reuses one agent session across turns; 'fresh-each' starts new (default persist). */
  sessionStrategy?: 'persist' | 'fresh-each';
}

// ── CLI parse ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const specPath = argv.find(a => !a.startsWith('--'));
const live = argv.includes('--live');
const maxItersFlag = flagVal('--max-iterations');

if (!specPath) {
  console.error('usage: bun run scripts/loop-runner.ts <goal-spec.json> [--live] [--max-iterations N]');
  process.exit(2);
}

const spec: GoalSpec = JSON.parse(readFileSync(resolve(specPath), 'utf-8'));
const repoRoot = resolve(import.meta.dir, '..');
const workdir = spec.workdir ? absFrom(repoRoot, spec.workdir) : repoRoot;
const maxIterations = maxItersFlag ? Number(maxItersFlag) : spec.maxIterations ?? 8;
const noProgressAndon = spec.noProgressAndon ?? 3;
const sessionStrategy = spec.sessionStrategy ?? 'persist';

const stateDir = join(workdir, '.loop', spec.slug);
mkdirSync(stateDir, { recursive: true });
const ledger = new ExperimentLedger(stateDir);

banner();

// ── The loop ───────────────────────────────────────────────────────────

let sessionId: string | undefined;
let lastDiagnostics: Record<string, string> = {};
let lastSig = progressSignature();
let noProgressStreak = 0;
let outcome: 'complete' | 'andon-no-progress' | 'exhausted' = 'exhausted';

for (let iter = 1; iter <= maxIterations; iter++) {
  log(`\n━━ iteration ${iter}/${maxIterations} ${'━'.repeat(30)}`);

  const prompt = composePrompt(iter, lastDiagnostics);

  if (live) {
    const turn = runAgentTurn(prompt, sessionStrategy === 'persist' ? sessionId : undefined);
    if (turn?.sessionId) sessionId = turn.sessionId;
    log(`  agent: ${turn ? `${turn.provider}/${turn.model ?? '?'} · budget ${turn.budget ?? '?'} · ${turn.durationMs}ms` : 'FAILED'}`);
    if (turn?.reply) log(`  reply: ${truncate(turn.reply, 240)}`);
  } else {
    log('  [dry] would run agent with prompt:');
    log(indent(prompt, '    | '));
  }

  // ── Layer 1 verification: the objective "done" check (hard gate) ──
  const ctx: TerminationContext = { vault: {} as never, budget: {} as never, goalRoot: workdir };
  const term = await evaluateTermination(spec.termination, ctx);
  lastDiagnostics = term.diagnostics;
  log(`  termination: shouldTerminate=${term.shouldTerminate} ${fmtDiag(term.diagnostics)}`);

  // ── furnace guard: no-progress detection (codex blocked-after-3×) ──
  const sig = progressSignature();
  if (sig === lastSig) noProgressStreak++;
  else { noProgressStreak = 0; lastSig = sig; }

  writeHandoff(iter, term.shouldTerminate, term.diagnostics, noProgressStreak);

  if (term.shouldTerminate) { outcome = 'complete'; log('\n✅ termination satisfied — goal complete.'); break; }
  if (live && noProgressStreak >= noProgressAndon) {
    outcome = 'andon-no-progress';
    log(`\n🛑 ANDON — ${noProgressStreak} consecutive no-progress turns. Stopping for human review.`);
    break;
  }
}

if (outcome === 'exhausted') log(`\n⏹  max iterations (${maxIterations}) reached without completion.`);
log(`\nhandoff → ${join(stateDir, 'NOW.md')}`);
process.exit(outcome === 'complete' ? 0 : 1);

// ── Prompt composition ─────────────────────────────────────────────────

function composePrompt(iter: number, diag: Record<string, string>): string {
  const prev = ledger.readNow();
  const auditByKind: Record<GoalSpec['goalKind'], string> = {
    coding: 'The objective checks are shell commands (tests, typecheck). Treat the task as UNPROVEN until every check exits 0. Make the checks pass — do not claim completion otherwise.',
    refactor: 'Preserve behavior. The objective checks verify tests stay green and the diff is scoped. Treat completion as UNPROVEN until they pass.',
    research: 'The objective checks count sources and verify a written summary. Treat the question as UNANSWERED until the evidence checks pass.',
    analysis: 'Treat conclusions as UNPROVEN until the objective checks pass with evidence.',
    monitoring: 'Establish the monitor and verify it fires. Treat the task as UNPROVEN until the objective check passes.',
  };
  return [
    `# Autonomous loop — iteration ${iter}`,
    ``,
    `## Goal (${spec.goalKind})`,
    spec.intake,
    ``,
    `## Completion audit`,
    auditByKind[spec.goalKind],
    `An EXTERNAL loop verifies completion with objective commands after your turn — you cannot self-declare done.`,
    ``,
    ...(Object.keys(diag).length
      ? [`## Objective checks — current status (from last verification)`,
         ...Object.entries(diag).map(([k, v]) => `- ${k}: ${v}`), ``]
      : []),
    ...(prev ? [`## Progress so far (NOW.md)`, prev, ``] : []),
    `## This turn`,
    `Make concrete progress toward passing the objective checks. Edit files, run commands, verify locally.`,
  ].join('\n');
}

// ── Agent turn (headless one-shot) ─────────────────────────────────────

interface TurnResult {
  sessionId?: string; provider?: string; model?: string | null;
  reply?: string; budget?: string; durationMs?: number;
}

function runAgentTurn(prompt: string, resumeId?: string): TurnResult | null {
  const args = ['run', 'src/index.ts', 'agent', '--json'];
  if (resumeId) args.push('--session', resumeId); else args.push('--new');
  args.push(prompt);
  const res = spawnSync('bun', args, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 && !res.stdout) {
    log(`  agent spawn failed: ${res.stderr?.slice(0, 300) ?? res.error?.message ?? 'unknown'}`);
    return null;
  }
  // strip ANSI/terminal control sequences the CLI emits on teardown, then find the JSON line
  const clean = (res.stdout || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
  const lines = clean.trim().split('\n').map(l => l.trim()).filter(Boolean);
  for (let k = lines.length - 1; k >= 0; k--) {
    const t = lines[k];
    if (t.startsWith('{') && t.endsWith('}')) {
      try { return JSON.parse(t); } catch { /* keep scanning */ }
    }
  }
  log(`  could not parse agent JSON: ${truncate(lines[lines.length - 1] ?? '', 200)}`);
  return null;
}

// ── Progress signature (git working-tree state) ────────────────────────

function progressSignature(): string {
  const res = spawnSync('git', ['status', '--porcelain'], { cwd: workdir, encoding: 'utf-8' });
  return createHash('sha1').update(res.stdout ?? '').digest('hex').slice(0, 12);
}

// ── NOW.md handoff ─────────────────────────────────────────────────────

function writeHandoff(iter: number, done: boolean, diag: Record<string, string>, streak: number) {
  ledger.writeNow([
    `# NOW — ${spec.slug}`,
    ``,
    `- iteration: ${iter}/${maxIterations}`,
    `- goalKind: ${spec.goalKind}`,
    `- shouldTerminate: ${done}`,
    `- no-progress streak: ${streak}/${noProgressAndon}`,
    `- session: ${sessionId ?? '(none / dry)'}`,
    ``,
    `## Objective checks`,
    ...Object.entries(diag).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Goal`,
    spec.intake,
  ].join('\n'));
}

// ── helpers ────────────────────────────────────────────────────────────

function banner() {
  log(`loop-runner · ${spec.slug} (${spec.goalKind})`);
  log(`  workdir      : ${workdir}`);
  log(`  state        : ${stateDir}`);
  log(`  mode         : ${live ? 'LIVE (mutates repo via agent)' : 'DRY (no agent invocation)'}`);
  log(`  maxIterations: ${maxIterations} · noProgressAndon: ${noProgressAndon}`);
}

function flagVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function absFrom(base: string, p: string): string { return isAbsolute(p) ? p : resolve(base, p); }
function fmtDiag(d: Record<string, string>): string {
  const e = Object.entries(d);
  return e.length ? `(${e.map(([k, v]) => `${k}: ${v}`).join('; ')})` : '';
}
function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s; }
function indent(s: string, p: string): string { return s.split('\n').map(l => p + l).join('\n'); }
function log(s: string) { console.log(s); }
