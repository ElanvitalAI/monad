// ── PFC-S3.8: PDCA (Plan-Do-Check-Act) cycle ──
//
// Deming / Shewhart's iterative improvement loop. One tool call = one
// phase advancement (same pattern as DMAIC). Stateless — the caller
// owns cycle state; tool validates per-phase required activities +
// suggests next phase.

export const PDCA_PHASES = ['plan', 'do', 'check', 'act'] as const;
export type PdcaPhase = (typeof PDCA_PHASES)[number];

export const PDCA_REQUIRED: Record<PdcaPhase, readonly string[]> = {
  plan: ['hypothesis', 'metric', 'duration'],
  do: ['pilot scope', 'owner'],
  check: ['result', 'vs hypothesis'],
  act: ['decision', 'next cycle'],
};

export type PdcaDecision = 'standardize' | 'adjust' | 'abort';

export interface PdcaPhaseInput {
  subject: string;
  phase: PdcaPhase;
  activities?: readonly string[];
  decision?: PdcaDecision;           // only honoured in 'act' phase
}

export interface PdcaPhaseReport {
  subject: string;
  phase: PdcaPhase;
  required: readonly string[];
  provided: readonly string[];
  completed: string[];
  pending: string[];
  progressPct: number;
  nextPhase: PdcaPhase | null;       // null when act+complete
  cycleComplete: boolean;
  decision?: PdcaDecision;
  notices?: string[];
}

export function runPdcaPhase(input: PdcaPhaseInput): PdcaPhaseReport {
  if (!input.subject?.trim()) {
    throw new Error('runPdcaPhase: subject is required');
  }
  if (!PDCA_PHASES.includes(input.phase)) {
    throw new Error(`runPdcaPhase: invalid phase '${input.phase}' (expected ${PDCA_PHASES.join(' | ')})`);
  }
  if (input.decision !== undefined && input.phase !== 'act') {
    // Silent ignore with notice — DD-PDCA-2
  }
  const required = PDCA_REQUIRED[input.phase];
  const provided = (input.activities ?? []).map((a) => a.trim()).filter((a) => a.length > 0);

  const completed: string[] = [];
  const pending: string[] = [];
  for (const req of required) {
    const hit = provided.some((p) => p.toLowerCase().includes(req.toLowerCase()));
    if (hit) completed.push(req);
    else pending.push(req);
  }
  const progressPct = Math.round((completed.length / required.length) * 100);

  const idx = PDCA_PHASES.indexOf(input.phase);
  const isActPhase = input.phase === 'act';
  const hasValidActDecision = isActPhase && input.decision !== undefined && progressPct === 100;
  const cycleComplete = hasValidActDecision;
  const nextPhase =
    cycleComplete
      ? null
      : idx + 1 < PDCA_PHASES.length
        ? PDCA_PHASES[idx + 1]
        : 'plan';   // wrap to next cycle if act not yet decided

  const notices: string[] = [];
  if (input.decision !== undefined && input.phase !== 'act') {
    notices.push(`decision='${input.decision}' ignored — only honoured in 'act' phase.`);
  }
  if (pending.length > 0) {
    notices.push(
      `${pending.length}/${required.length} activities pending — stay in '${input.phase}' before advancing.`,
    );
  }
  if (isActPhase && progressPct === 100 && input.decision === undefined) {
    notices.push(`Act phase complete but no decision provided — supply decision='standardize'|'adjust'|'abort' to close the cycle.`);
  }
  if (cycleComplete) {
    notices.push(`PDCA cycle complete — ready_to_archive=true (consider WriteA3 + next cycle with Plan).`);
  }

  return {
    subject: input.subject.trim(),
    phase: input.phase,
    required,
    provided,
    completed,
    pending,
    progressPct,
    nextPhase,
    cycleComplete,
    ...(hasValidActDecision && input.decision ? { decision: input.decision } : {}),
    ...(notices.length > 0 ? { notices } : {}),
  };
}

export function renderPdcaPhase(report: PdcaPhaseReport): string {
  const lines: string[] = [];
  lines.push(`PDCA [${report.phase.toUpperCase()}] ${report.subject}`);
  lines.push(`  progress: ${report.progressPct}% (${report.completed.length}/${report.required.length})`);
  if (report.cycleComplete) {
    lines.push(`  cycle complete · decision=${report.decision ?? '?'}`);
  } else if (report.nextPhase) {
    lines.push(`  next phase: ${report.nextPhase.toUpperCase()}${report.phase === 'act' ? ' (new cycle)' : ''}`);
  }
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
  return lines.join('\n');
}
