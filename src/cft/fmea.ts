// ── PFC-S3.4: FMEA (Failure Mode & Effects Analysis) ──
//
// Deterministic RPN (Risk Priority Number) calculation + risk tier
// classification. The analysis itself (identifying modes, effects,
// causes) is done by the parent LLM; this module only does the math.
//
// RPN = Severity × Occurrence × Detection, each 1-10 per Six Sigma.
// Higher RPN = higher risk. Out-of-range inputs raise RangeError
// rather than silently clipping (DD-FMEA-2).

export type FMEAFactor = number;   // 1..10 integer (validated)

export interface FMEARow {
  mode: string;              // "메시지 중복 전송"
  effect: string;            // "사용자 혼란"
  cause: string;             // "idempotency key 미구현"
  severity: FMEAFactor;      // 1..10
  occurrence: FMEAFactor;    // 1..10
  detection: FMEAFactor;     // 1..10
  recommended_action?: string;
}

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface RankedFMEARow extends FMEARow {
  rpn: number;               // 1..1000
  risk: RiskTier;
}

export interface FMEASummary {
  total_items: number;
  max_rpn: number;
  mean_rpn: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

export interface FMEAReport {
  system: string;
  ranked: RankedFMEARow[];
  top: RankedFMEARow[];
  summary: FMEASummary;
}

function assertFactor(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > 10) {
    throw new RangeError(
      `FMEA: ${name} must be integer in [1, 10], got ${String(v)}`,
    );
  }
}

/** RPN = severity × occurrence × detection. Each factor 1..10; result 1..1000. */
export function computeRpn(row: Pick<FMEARow, 'severity' | 'occurrence' | 'detection'>): number {
  assertFactor('severity', row.severity);
  assertFactor('occurrence', row.occurrence);
  assertFactor('detection', row.detection);
  return row.severity * row.occurrence * row.detection;
}

/** Risk tier thresholds per DD-FMEA-1:
 *    1-49   low       ("cleared") — no action required
 *    50-124 medium    ("watch")   — plan recommended action
 *    125-299 high     ("act")     — schedule countermeasure
 *    300+   critical  ("halt")    — immediate Andon-worthy
 */
export function classifyRisk(rpn: number): RiskTier {
  if (rpn <= 0) throw new RangeError(`FMEA: rpn must be positive, got ${rpn}`);
  if (rpn < 50) return 'low';
  if (rpn < 125) return 'medium';
  if (rpn < 300) return 'high';
  return 'critical';
}

/** Rank all rows by RPN descending, stable (input order ties). */
export function rankRows(rows: readonly FMEARow[]): RankedFMEARow[] {
  const enriched = rows.map((row, i) => ({
    ...row,
    rpn: computeRpn(row),
    risk: classifyRisk(computeRpn(row)),
    _origIdx: i,
  }));
  enriched.sort((a, b) => {
    if (b.rpn !== a.rpn) return b.rpn - a.rpn;
    return a._origIdx - b._origIdx;  // stable
  });
  return enriched.map(({ _origIdx, ...rest }) => rest);
}

/** Build full FMEA report from raw rows. topN default 3. */
export function buildReport(
  system: string,
  rows: readonly FMEARow[],
  topN = 3,
): FMEAReport {
  if (!system || !system.trim()) {
    throw new Error('FMEA: system is required');
  }
  if (rows.length === 0) {
    throw new Error('FMEA: at least one row required');
  }
  const ranked = rankRows(rows);
  const top = ranked.slice(0, Math.max(1, topN));
  const rpns = ranked.map((r) => r.rpn);
  const summary: FMEASummary = {
    total_items: ranked.length,
    max_rpn: Math.max(...rpns),
    mean_rpn: Math.round((rpns.reduce((a, b) => a + b, 0) / rpns.length) * 10) / 10,
    critical_count: ranked.filter((r) => r.risk === 'critical').length,
    high_count: ranked.filter((r) => r.risk === 'high').length,
    medium_count: ranked.filter((r) => r.risk === 'medium').length,
    low_count: ranked.filter((r) => r.risk === 'low').length,
  };
  return { system, ranked, top, summary };
}

/** Render a compact human-readable table of the top N rows. */
export function renderTopTable(report: FMEAReport): string {
  const lines: string[] = [];
  lines.push(`FMEA [${report.system}] ${report.summary.total_items} items · max RPN=${report.summary.max_rpn}`);
  lines.push(
    `  critical=${report.summary.critical_count} `
    + `high=${report.summary.high_count} `
    + `medium=${report.summary.medium_count} `
    + `low=${report.summary.low_count}`,
  );
  lines.push('');
  lines.push('  # | RPN  | risk     | mode');
  lines.push('  --+------+----------+-----------------------------------------');
  report.top.forEach((r, i) => {
    const rpn = String(r.rpn).padStart(4, ' ');
    const risk = r.risk.padEnd(8, ' ');
    const idx = String(i + 1).padStart(2, ' ');
    lines.push(`  ${idx} | ${rpn} | ${risk} | ${r.mode}`);
  });
  return lines.join('\n');
}
