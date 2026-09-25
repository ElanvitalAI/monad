// ── PFC-S3.7: DMAIC (Six Sigma 5-phase) ──
//
// DMAIC = Define / Measure / Analyze / Improve / Control. One tool
// call = one phase advancement. Parent LLM drives the orchestration —
// typically 5 sequential calls, one per phase, each checking off the
// required activities. Tool enforces phase order + required-activity
// coverage, returns checklist + progress + next phase suggestion.

export const DMAIC_PHASES = ['define', 'measure', 'analyze', 'improve', 'control'] as const;
export type DmaicPhase = (typeof DMAIC_PHASES)[number];

/** Canonical required activities per phase. LLM must supply `activities`
 *  that cover this set (fuzzy — substring match case-insensitive). */
export const DMAIC_REQUIRED: Record<DmaicPhase, readonly string[]> = {
  define: ['problem', 'goal', 'scope', 'stakeholders'],
  measure: ['baseline', 'metric', 'data source'],
  analyze: ['root cause', 'hypothesis'],
  improve: ['countermeasure', 'pilot'],
  control: ['monitor', 'standardize', 'handoff'],
};

export interface DmaicPhaseInput {
  problem: string;
  phase: DmaicPhase;
  activities?: readonly string[];   // what the LLM actually did this phase
}

export interface DmaicPhaseReport {
  problem: string;
  phase: DmaicPhase;
  required: readonly string[];      // required activities for this phase
  provided: readonly string[];      // supplied by caller, normalized
  completed: string[];              // subset of required that was covered
  pending: string[];                // required - completed
  progressPct: number;              // 0..100
  nextPhase: DmaicPhase | null;     // null at 'control'
  notices?: string[];
}

export function runDmaicPhase(input: DmaicPhaseInput): DmaicPhaseReport {
  if (!input.problem?.trim()) {
    throw new Error('runDmaicPhase: problem is required');
  }
  if (!DMAIC_PHASES.includes(input.phase)) {
    throw new Error(`runDmaicPhase: invalid phase '${input.phase}' (expected ${DMAIC_PHASES.join(' | ')})`);
  }
  const required = DMAIC_REQUIRED[input.phase];
  const provided = (input.activities ?? []).map((a) => a.trim()).filter((a) => a.length > 0);

  // Fuzzy match — required item is "completed" if any provided activity contains it (case-insensitive substring).
  const completed: string[] = [];
  const pending: string[] = [];
  for (const req of required) {
    const hit = provided.some((p) => p.toLowerCase().includes(req.toLowerCase()));
    if (hit) completed.push(req);
    else pending.push(req);
  }
  const progressPct = Math.round((completed.length / required.length) * 100);

  const idx = DMAIC_PHASES.indexOf(input.phase);
  const nextPhase = idx + 1 < DMAIC_PHASES.length ? DMAIC_PHASES[idx + 1] : null;

  const notices: string[] = [];
  if (pending.length > 0) {
    notices.push(
      `${pending.length}/${required.length} required activities pending — consider staying in '${input.phase}' `
      + `before advancing.`,
    );
  }
  if (progressPct === 100 && nextPhase) {
    notices.push(`All ${input.phase} activities complete — advance to '${nextPhase}' on next call.`);
  }
  if (progressPct === 100 && !nextPhase) {
    notices.push(`DMAIC cycle complete — consider WriteA3 to archive + Kaizen for next iteration.`);
  }

  return {
    problem: input.problem.trim(),
    phase: input.phase,
    required,
    provided,
    completed,
    pending,
    progressPct,
    nextPhase,
    ...(notices.length > 0 ? { notices } : {}),
  };
}

export function renderDmaicPhase(report: DmaicPhaseReport): string {
  const lines: string[] = [];
  lines.push(`DMAIC [${report.phase.toUpperCase()}] ${report.problem}`);
  lines.push(`  progress: ${report.progressPct}% (${report.completed.length}/${report.required.length})`);
  lines.push('');
  lines.push('  required activities:');
  report.required.forEach((r) => {
    const mark = report.completed.includes(r) ? '[x]' : '[ ]';
    lines.push(`    ${mark} ${r}`);
  });
  if (report.provided.length > 0) {
    lines.push('');
    lines.push('  provided:');
    report.provided.forEach((p) => lines.push(`    - ${p}`));
  }
  if (report.nextPhase) {
    lines.push('');
    lines.push(`  next phase: ${report.nextPhase.toUpperCase()}`);
  }
  return lines.join('\n');
}
