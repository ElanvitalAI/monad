// ── PFC-S3.9: Quick-Kill Go/Hold/Kill triage ──
//
// Stage-Gate / Lean Startup style 3-way decision. Takes 3 factor
// inputs (evidence confidence · remaining runway · pivot cost) + a
// directional signal, computes a transparent score, and recommends
// go / hold / kill. Heuristic is intentionally simple so the LLM
// can understand + override when confidence is low.

export type QuickKillDecision = 'go' | 'hold' | 'kill';
export type QuickKillSignal = 'positive' | 'neutral' | 'negative';

export interface QuickKillInput {
  subject: string;
  evidence_confidence: number;       // 0..10
  remaining_runway: number;          // 0..10
  pivot_cost: number;                // 0..10
  current_signal: QuickKillSignal;
}

export interface QuickKillReport {
  subject: string;
  decision: QuickKillDecision;
  score: number;
  confidence: number;                // 0..1
  rationale: string;
  next_step: string;
  factors: {
    evidence_confidence: number;
    remaining_runway: number;
    pivot_cost: number;
    current_signal: QuickKillSignal;
    signal_factor: number;
    runway_factor: number;
  };
  notices?: string[];
}

function assertFactor(name: string, v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) {
    throw new RangeError(`QuickKill: ${name} must be number in [0, 10], got ${String(v)}`);
  }
}

const SIGNAL_FACTOR: Record<QuickKillSignal, number> = {
  positive: 1.0,
  neutral: 0.3,
  negative: -1.0,
};

/**
 * Score formula (DD-QK-1):
 *   signal_factor = {positive:1, neutral:0.3, negative:-1}
 *   runway_factor = (10 - remaining_runway) / 10     // low runway → high cost weight
 *   score = evidence_confidence × signal_factor - pivot_cost × runway_factor × 1.5
 *
 * Decision:
 *   score > 3   → go
 *   -3..3       → hold
 *   score < -3  → kill
 *
 * Confidence (DD-QK-2): halved when signal and score directions disagree.
 */
export function triageQuickKill(input: QuickKillInput): QuickKillReport {
  if (!input.subject?.trim()) {
    throw new Error('triageQuickKill: subject is required');
  }
  assertFactor('evidence_confidence', input.evidence_confidence);
  assertFactor('remaining_runway', input.remaining_runway);
  assertFactor('pivot_cost', input.pivot_cost);
  if (!['positive', 'neutral', 'negative'].includes(input.current_signal)) {
    throw new Error(`triageQuickKill: invalid current_signal '${input.current_signal}'`);
  }

  const signal_factor = SIGNAL_FACTOR[input.current_signal];
  const runway_factor = (10 - input.remaining_runway) / 10;
  const score =
    input.evidence_confidence * signal_factor
    - input.pivot_cost * runway_factor * 1.5;

  let decision: QuickKillDecision;
  if (score > 3) decision = 'go';
  else if (score < -3) decision = 'kill';
  else decision = 'hold';

  // Confidence — normalise |score| to 0..1, cap at 1.0
  let confidence = Math.min(1, Math.abs(score) / 10);
  const signalScoreDisagree =
    (input.current_signal === 'positive' && score < 0)
    || (input.current_signal === 'negative' && score > 0);
  if (signalScoreDisagree) {
    confidence = Math.max(0.1, confidence * 0.5);
  }

  const notices: string[] = [];
  if (confidence < 0.5) {
    notices.push('confidence < 0.5 — recommend human review before acting on this decision.');
  }
  if (decision === 'kill' && input.remaining_runway >= 7) {
    notices.push('kill decision despite ample runway — double-check negative signal interpretation.');
  }
  if (decision === 'go' && input.evidence_confidence < 5) {
    notices.push('go decision with low evidence confidence — consider requesting more data first.');
  }

  const rationale = buildRationale(input, { score, signal_factor, runway_factor, decision });
  const next_step = buildNextStep(decision, input);

  return {
    subject: input.subject.trim(),
    decision,
    score: Math.round(score * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    rationale,
    next_step,
    factors: {
      evidence_confidence: input.evidence_confidence,
      remaining_runway: input.remaining_runway,
      pivot_cost: input.pivot_cost,
      current_signal: input.current_signal,
      signal_factor,
      runway_factor: Math.round(runway_factor * 100) / 100,
    },
    ...(notices.length > 0 ? { notices } : {}),
  };
}

function buildRationale(
  input: QuickKillInput,
  calc: { score: number; signal_factor: number; runway_factor: number; decision: QuickKillDecision },
): string {
  const { score, decision } = calc;
  return (
    `signal=${input.current_signal} (×${calc.signal_factor}) · `
    + `evidence=${input.evidence_confidence} → contribution ${(input.evidence_confidence * calc.signal_factor).toFixed(1)} · `
    + `pivot_cost=${input.pivot_cost} × runway_factor=${calc.runway_factor.toFixed(2)} → penalty ${(input.pivot_cost * calc.runway_factor * 1.5).toFixed(1)} · `
    + `score=${score.toFixed(1)} → ${decision}`
  );
}

function buildNextStep(
  decision: QuickKillDecision,
  input: QuickKillInput,
): string {
  if (decision === 'go') {
    return `Continue with '${input.subject}' — set next PDCA/DMAIC milestone + re-triage in 1 week.`;
  }
  if (decision === 'kill') {
    return `Stop '${input.subject}' — write Hansei (post-mortem) capturing learnings and redirect resources.`;
  }
  return `Pause '${input.subject}' — gather more evidence${
    input.evidence_confidence < 5 ? ' (evidence is weak)' : ''
  } before next triage in ${input.remaining_runway < 3 ? '48h' : '1 week'}.`;
}

export function renderQuickKill(report: QuickKillReport): string {
  const lines: string[] = [];
  lines.push(`Quick-Kill [${report.subject}]`);
  lines.push(`  decision: ${report.decision.toUpperCase()} (score=${report.score}, confidence=${report.confidence})`);
  lines.push(`  rationale: ${report.rationale}`);
  lines.push(`  next_step: ${report.next_step}`);
  return lines.join('\n');
}
