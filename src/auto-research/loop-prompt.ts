// ── PFC-S3 P5: turn-kickoff loop-prompt snapshot ──
//
// Read-only primitive — builds a structured snapshot of the research
// loop state (plan + pending questions + recent wins + budget +
// NOW.md + termination outcome) and renders it into a multi-section
// markdown string suitable for systemPromptInject at the start of
// every autonomous-research turn.
//
// The PFC-S4 LLM tools will expose this via /research tail and the
// EnterAutoMode driver will call renderLoopPromptInjection() each
// turn kickoff.

import {
  readNote,
  type ObsidianVault,
} from './obsidian-bridge.js';
import {
  formatBudgetLine,
  type BudgetMeter,
  type BudgetSnapshot,
} from './budget-meter.js';
import type { ExperimentLedger } from './experiment-ledger.js';
import {
  evaluateTermination,
  type TerminationContext,
  type TerminationOutcome,
  type TerminationRule,
} from './termination-dsl.js';

export interface LoopPromptContext {
  vault: ObsidianVault;
  goalSlug: string;
  goalRoot: string;                    // absolute — usually <vault.root>/goals/<slug>
  budget: BudgetMeter;
  ledger: ExperimentLedger;
  termination: TerminationRule;
  /** Optional intelligence-map text (PFC-S5 P5) — injected as an
   *  extra section when provided. The S4 EnterAutoMode dispatcher
   *  resolves this via dispatchIntelligenceMap when requested. */
  intelligenceMap?: string;
  /** Optional Andon preamble (PFC-S3.1 follow-up) — `buildAndonPreamble()`
   *  from src/cft/andon.ts returns a `🔴 ANDON ESCALATION` banner when
   *  any CRITICAL signal is pending, or null otherwise. When provided,
   *  renderLoopPromptInjection emits a `## Andon` section at the top
   *  of the prompt. */
  andonPreamble?: string;
  /** Optional Goal Kind block (PFC-S2 generalization) — when provided,
   *  renderLoopPromptInjection emits a `## Goal Kind` section right
   *  after Andon so the LLM can see what kind of goal this loop is
   *  pursuing (research / coding / analysis / monitoring / refactor). */
  goalKindBlock?: string;
  /** Optional AXON P5 turn-level termination decision (from
   *  `src/axon/termination-detector.ts`). Rendered as a `## Axon
   *  Termination` section when provided — complements the goal-level
   *  termination rule above. Caller is responsible for computing the
   *  decision each turn and threading it through (loop-prompt itself
   *  stays pure). */
  axonTermination?: AxonTerminationSnapshot;
}

/** Minimal view of `ShouldTerminateDecision` loop-prompt consumes.
 *  Decoupled from the detector module so `loop-prompt.ts` never
 *  imports `src/axon/*` and stays in `src/auto-research/`. Callers
 *  build this from `formatTerminationForPrompt()` output or a
 *  manual shape. */
export interface AxonTerminationSnapshot {
  shouldTerminate: boolean;
  confidence: 'high' | 'medium' | 'low';
  satisfiedCount: number;
  reason: string;
  /** Full render — matches `formatTerminationForPrompt()` output. */
  prompt: string;
}

export interface LoopPromptSnapshot {
  plan: string;
  queuePending: string[];
  recentWins: string[];
  budget: BudgetSnapshot;
  budgetLine: string;
  nowNote: string | null;
  termination: TerminationOutcome;
  intelligenceMap?: string;
  andonPreamble?: string;
  goalKindBlock?: string;
  /** AXON P5 — turn-level termination decision. Mirrors the ctx
   *  field; rendered by `renderLoopPromptInjection` as a dedicated
   *  section when present. */
  axonTermination?: AxonTerminationSnapshot;
}

export const LOOP_SECTION_CAPS = {
  plan: 2000,
  wins: 500,
  nowNote: 1000,
} as const;

export async function buildLoopPromptSnapshot(ctx: LoopPromptContext): Promise<LoopPromptSnapshot> {
  const planRaw = readNote(ctx.vault, relFromVault(ctx, 'plan.md')) ?? '';
  const queueRaw = readNote(ctx.vault, relFromVault(ctx, 'question-queue.md')) ?? '';
  const winsRaw = readNote(ctx.vault, relFromVault(ctx, 'knowledge/wins.md')) ?? '';
  const nowNote = ctx.ledger.readNow();
  const budget = ctx.budget.snapshot();
  const budgetLine = formatBudgetLine(budget);
  const terminationCtx: TerminationContext = {
    vault: ctx.vault,
    budget: ctx.budget,
    goalRoot: ctx.goalRoot,
  };
  const termination = await evaluateTermination(ctx.termination, terminationCtx);

  return {
    plan: trim(planRaw, LOOP_SECTION_CAPS.plan),
    queuePending: parseQueuePending(queueRaw),
    recentWins: parseWinTail(winsRaw, 3),
    budget,
    budgetLine,
    nowNote: nowNote ? trim(nowNote, LOOP_SECTION_CAPS.nowNote) : null,
    termination,
    ...(ctx.intelligenceMap ? { intelligenceMap: ctx.intelligenceMap } : {}),
    ...(ctx.andonPreamble ? { andonPreamble: ctx.andonPreamble } : {}),
    ...(ctx.goalKindBlock ? { goalKindBlock: ctx.goalKindBlock } : {}),
    ...(ctx.axonTermination ? { axonTermination: ctx.axonTermination } : {}),
  };
}

export function renderLoopPromptInjection(snap: LoopPromptSnapshot): string {
  const lines: string[] = [];
  if (snap.andonPreamble) {
    lines.push('## Andon');
    lines.push(snap.andonPreamble);
    lines.push('');
  }
  if (snap.goalKindBlock) {
    lines.push('## Goal Kind');
    lines.push(snap.goalKindBlock);
    lines.push('');
  }
  lines.push('# Research Loop State');
  lines.push('');
  lines.push('## Plan');
  lines.push(snap.plan.trim() || '(plan not yet drafted)');
  lines.push('');
  lines.push(`## Question Queue (${snap.queuePending.length} pending)`);
  if (snap.queuePending.length === 0) {
    lines.push('(none)');
  } else {
    for (const q of snap.queuePending.slice(0, 10)) lines.push(`- [ ] ${q}`);
  }
  lines.push('');
  lines.push('## Recent Wins');
  if (snap.recentWins.length === 0) {
    lines.push('(no wins recorded yet)');
  } else {
    for (const w of snap.recentWins) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push('## Budget');
  lines.push(snap.budgetLine || '(budget unlimited)');
  if (snap.budget.tripped.length > 0) {
    lines.push(`⚠ TRIPPED: ${snap.budget.tripped.join(', ')}`);
  } else if (snap.budget.warning.length > 0) {
    lines.push(`⚠ warning (≥90%): ${snap.budget.warning.join(', ')}`);
  }
  lines.push('');
  // Completion audit (§5-②) — adversarial framing so the model treats
  // completion as unproven and works the objective conditions rather
  // than self-declaring done. Surfaces per-rule diagnostics as evidence
  // and gives an explicit ExitAutoMode directive keyed on the verdict.
  lines.push('## Completion Audit');
  lines.push('Treat completion as UNPROVEN. An objective verifier re-checks these');
  lines.push('conditions after your turn — you cannot self-declare done.');
  const done = snap.termination.shouldTerminate;
  lines.push(`verdict: ${done ? 'OBJECTIVE CHECKS PASS' : 'NOT COMPLETE'} (shouldTerminate=${done})`);
  const satLines = renderConditions(snap.termination.satisfied, snap.termination.diagnostics);
  const unsatLines = renderConditions(snap.termination.unsatisfied, snap.termination.diagnostics);
  if (satLines.length > 0) {
    lines.push('satisfied:');
    for (const l of satLines) lines.push(`  ✓ ${l}`);
  }
  if (unsatLines.length > 0) {
    lines.push('unsatisfied (evidence still required):');
    for (const l of unsatLines) lines.push(`  ✗ ${l}`);
  }
  if (done) {
    lines.push('→ Objective checks pass. To finish, call ExitAutoMode with '
      + 'reason="termination_met" AND a `summary` citing the evidence for each '
      + 'condition. Do not stop without that summary.');
  } else {
    lines.push('→ NOT done. Keep working the unsatisfied conditions above. Do NOT '
      + 'call ExitAutoMode(reason="termination_met") — an unproven completion '
      + 'claim will be rejected.');
  }
  lines.push('');
  lines.push('## NOW handoff');
  lines.push(snap.nowNote ?? '(no handoff note)');
  if (snap.intelligenceMap) {
    lines.push('');
    lines.push('## Intelligence Map');
    lines.push(snap.intelligenceMap);
  }
  if (snap.axonTermination) {
    lines.push('');
    lines.push('## Axon Termination (turn-level)');
    lines.push(snap.axonTermination.prompt);
  }
  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────

function relFromVault(ctx: LoopPromptContext, subpath: string): string {
  // If the goal root lives inside the vault, use the relative path.
  // Otherwise fall back to an absolute path (readNote still resolves
  // by joining against vault.root, so we prepend an absolute-ish
  // segment to escape).
  if (ctx.goalRoot.startsWith(ctx.vault.root)) {
    const rel = ctx.goalRoot.slice(ctx.vault.root.length).replace(/^\/+/, '');
    return rel ? `${rel}/${subpath}` : subpath;
  }
  // Fallback — absolute by concatenating in readNote ignores vault root.
  // readNote treats relPath as relative, so callers with goalRoot
  // outside the vault should pre-write the files there.
  return `goals/${ctx.goalSlug}/${subpath}`;
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n\n[truncated]';
}

/** Parse a markdown checklist and return every item marked `- [ ]`
 *  (unchecked). Shared with AXON F2 `buildAxonTerminationSnapshotForGoal`
 *  so the clarifying-questions factor doesn't reimplement the parser. */
export function parseQueuePending(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*-\s*\[\s\]\s+(.+)$/);
    if (m) out.push(m[1]!.trim());
  }
  return out;
}

function parseWinTail(raw: string, limit: number): string[] {
  const wins: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*-\s+(.+)$/);
    if (m) wins.push(m[1]!.trim());
  }
  return wins.slice(-limit);
}

/** Flatten a rule list to leaf conditions, attaching each rule's
 *  diagnostic (keyed by rule.kind in TerminationOutcome.diagnostics)
 *  as evidence the model can act on. Composite `and`/`or` nodes expand
 *  to their children so the audit lists concrete conditions. */
function renderConditions(rules: TerminationRule[], diagnostics: Record<string, string>): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (r.kind === 'and' || r.kind === 'or') {
      out.push(...renderConditions(r.rules, diagnostics));
    } else {
      const diag = diagnostics[r.kind];
      out.push(diag ? `${r.kind} — ${diag}` : r.kind);
    }
  }
  return out;
}
