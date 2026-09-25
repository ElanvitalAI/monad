// ── PFC-S3.10: Escalation Ladder (4-tier SLA routing) ──
//
// ITSM / Toyota Andon tiered escalation — an incident moves up the
// ladder when the current tier's SLA elapses without resolution. This
// module is routing logic only; actual notification dispatch (Slack,
// Telegram, paging) is the caller's responsibility via
// AXON P4 HitlRouter or similar.

export type EscalationTier = 1 | 2 | 3 | 4;

export const TIER_RECIPIENTS: Record<EscalationTier, string> = {
  1: 'peer',
  2: 'lead',
  3: 'manager',
  4: 'director',
};

/** Minutes per-tier SLA. 15m peer → 60m lead → 4h manager → 24h director. */
export const TIER_SLA_MINUTES: Record<EscalationTier, number> = {
  1: 15,
  2: 60,
  3: 240,
  4: 1440,
};

export type IncidentSeverity = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';

/** Initial tier when an incident first enters the ladder, per severity.
 *  LOW gets tier 1 but should_escalate stays false until SLA breach. */
export const SEVERITY_INITIAL_TIER: Record<IncidentSeverity, EscalationTier> = {
  LOW: 1,
  MED: 1,
  HIGH: 2,
  CRITICAL: 3,   // CRITICAL starts high
};

export interface EscalateLadderInput {
  incident_id: string;
  severity: IncidentSeverity;
  minutes_since_start: number;
  current_tier?: EscalationTier;     // 0 / undefined = not yet notified
}

export interface EscalateLadderReport {
  incident_id: string;
  severity: IncidentSeverity;
  previous_tier: EscalationTier | null;
  next_tier: EscalationTier;
  recipient_role: string;
  sla_minutes: number;
  should_escalate: boolean;
  rationale: string;
  notices?: string[];
}

function isValidTier(t: unknown): t is EscalationTier {
  return t === 1 || t === 2 || t === 3 || t === 4;
}

/** Routing logic:
 *   - If no current_tier: use SEVERITY_INITIAL_TIER[severity]
 *   - Else check if minutes_since_start >= cumulative SLA through current_tier
 *     → advance to current_tier + 1 (capped at 4)
 *   - CRITICAL locks at ≥3; cannot deescalate (DD-ESCAL-2)
 *   - LOW severity: should_escalate stays false unless user explicitly advances
 */
export function escalateLadder(input: EscalateLadderInput): EscalateLadderReport {
  if (!input.incident_id?.trim()) {
    throw new Error('escalateLadder: incident_id is required');
  }
  if (!Object.keys(SEVERITY_INITIAL_TIER).includes(input.severity)) {
    throw new Error(`escalateLadder: invalid severity '${input.severity}'`);
  }
  if (typeof input.minutes_since_start !== 'number' || !Number.isFinite(input.minutes_since_start) || input.minutes_since_start < 0) {
    throw new Error('escalateLadder: minutes_since_start must be non-negative finite number');
  }
  if (input.current_tier !== undefined && !isValidTier(input.current_tier)) {
    throw new Error(`escalateLadder: invalid current_tier '${input.current_tier}'`);
  }

  const notices: string[] = [];
  const previous_tier: EscalationTier | null = input.current_tier ?? null;

  // First notification: use initial tier by severity
  if (previous_tier === null) {
    const initial = SEVERITY_INITIAL_TIER[input.severity];
    const should_escalate = input.severity !== 'LOW';
    if (input.severity === 'LOW') {
      notices.push(
        `LOW severity: no escalation required. '${input.incident_id}' logged as hint to tier-1 (peer).`,
      );
    }
    const rationale =
      `first notification · severity=${input.severity} → initial tier ${initial} (${TIER_RECIPIENTS[initial]}) · SLA ${TIER_SLA_MINUTES[initial]}m`;
    return {
      incident_id: input.incident_id,
      severity: input.severity,
      previous_tier,
      next_tier: initial,
      recipient_role: TIER_RECIPIENTS[initial],
      sla_minutes: TIER_SLA_MINUTES[initial],
      should_escalate,
      rationale,
      ...(notices.length > 0 ? { notices } : {}),
    };
  }

  // Already notified — evaluate SLA breach
  const currentSla = TIER_SLA_MINUTES[previous_tier];
  const slaElapsed = input.minutes_since_start >= currentSla;
  const atMaxTier = previous_tier === 4;

  let next_tier: EscalationTier = previous_tier;
  let should_escalate = false;
  let rationale: string;

  if (slaElapsed && !atMaxTier) {
    next_tier = (previous_tier + 1) as EscalationTier;
    should_escalate = true;
    rationale =
      `SLA breach · elapsed=${input.minutes_since_start}m ≥ ${currentSla}m (tier ${previous_tier}) `
      + `→ escalate to tier ${next_tier} (${TIER_RECIPIENTS[next_tier]})`;
  } else if (atMaxTier && slaElapsed) {
    rationale =
      `at max tier 4 (${TIER_RECIPIENTS[4]}) · elapsed=${input.minutes_since_start}m ≥ SLA ${currentSla}m `
      + `— further escalation not possible; keep paging director.`;
    notices.push('at max tier with SLA breach — consider external escalation path (board / CEO / regulatory).');
  } else {
    rationale =
      `within tier ${previous_tier} SLA · elapsed=${input.minutes_since_start}m < ${currentSla}m · `
      + `stay with ${TIER_RECIPIENTS[previous_tier]}`;
  }

  // CRITICAL guard — never deescalate below tier 3 (DD-ESCAL-2)
  if (input.severity === 'CRITICAL' && next_tier < 3) {
    notices.push(
      `CRITICAL severity cannot deescalate — forcing tier ${Math.max(3, next_tier)} minimum.`,
    );
    next_tier = 3;
    should_escalate = true;
  }

  return {
    incident_id: input.incident_id,
    severity: input.severity,
    previous_tier,
    next_tier,
    recipient_role: TIER_RECIPIENTS[next_tier],
    sla_minutes: TIER_SLA_MINUTES[next_tier],
    should_escalate,
    rationale,
    ...(notices.length > 0 ? { notices } : {}),
  };
}

export function renderEscalateLadder(report: EscalateLadderReport): string {
  const lines: string[] = [];
  lines.push(`Escalation [${report.incident_id}] severity=${report.severity}`);
  lines.push(
    `  tier ${report.previous_tier ?? '—'} → ${report.next_tier} (${report.recipient_role}) · `
    + `SLA ${report.sla_minutes}m · should_escalate=${report.should_escalate}`,
  );
  lines.push(`  rationale: ${report.rationale}`);
  return lines.join('\n');
}
