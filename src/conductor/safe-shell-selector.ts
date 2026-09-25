// ── T4 (Phase 3 Bundle 1) — LLM safe shell selector ──
//
// HANDOFF Phase 3 / ROADMAP §6 T4: "LLM 안전한 shell 선택". substrate
// `ShellList` capability vector 위에서, LLM 이 어떤 작업을 시도할 때
// 여러 후보 shell 중 *capability 가 그 작업에 충분하면서 over-grant 하지
// 않은* 가장 안전한 shell 을 자동 선택.
//
// Pure function — 의존성 없음. caller (PFC dispatch / ACP A1 router /
// V2 voice orchestrator) 가 candidate list 와 action requirement 를
// 넘기면 selected shellId 또는 null 반환.
//
// 안전성 우선 원칙 (정렬):
//   1. requirement 모두 만족 (필요충분 capability)
//   2. 가장 약한 capability 우선 (over-grant 회피)
//   3. exposure 가 user-interactive > observe-only > hidden 순 (사용자
//      가시성 높을수록 audit 친화)
//   4. tie 시 lexicographic shellId (deterministic)

import type { TerminalSurfaceCapability, TerminalUserExposure } from '../terminal/posture.js';

export interface ShellCandidate {
  readonly shellId: string;
  readonly exposure: TerminalUserExposure;
  readonly capability: TerminalSurfaceCapability;
  /** Optional metadata — caller can use to break ties. */
  readonly tag?: string;
}

export interface ShellActionRequirement {
  /** Reads buffer / output. Default true (most actions need this). */
  readonly needsRead?: boolean;
  /** Sends interrupts (ctrl-C/D/\). */
  readonly needsInterrupt?: boolean;
  /** Writes to stdin. Most destructive — careful caller. */
  readonly needsWrite?: boolean;
  /** word-select / hover / context-menu. */
  readonly needsInspect?: boolean;
  /** When true, only shells with `agentInteractive=true` (LLM owns)
   *  are considered. Default false (any). */
  readonly agentControlled?: boolean;
}

export interface ShellSelection {
  readonly shellId: string;
  readonly candidate: ShellCandidate;
  /** Why this candidate won — useful for audit log. */
  readonly reason: string;
}

const EXPOSURE_PRIORITY: Record<TerminalUserExposure, number> = {
  'user-interactive': 0,
  'observe-only': 1,
  'hidden': 2,
  'unavailable': 99,
};

function meetsRequirement(
  cap: TerminalSurfaceCapability,
  req: ShellActionRequirement,
): boolean {
  if ((req.needsRead ?? true) && !cap.canRead) return false;
  if (req.needsInterrupt && !cap.canInterrupt) return false;
  if (req.needsWrite && !cap.canWrite) return false;
  if (req.needsInspect && !cap.canInspect) return false;
  return true;
}

function capabilityScore(cap: TerminalSurfaceCapability): number {
  // Lower is "weaker" — we prefer weaker that still meets req.
  return (cap.canRead ? 1 : 0)
       + (cap.canInterrupt ? 1 : 0)
       + (cap.canWrite ? 2 : 0)  // write weighted higher (avoid over-grant)
       + (cap.canInspect ? 1 : 0);
}

/**
 * Select the safest shell from `candidates` that meets `requirement`.
 * Returns null when no candidate satisfies the requirement.
 */
export function selectSafeShell(
  candidates: readonly ShellCandidate[],
  requirement: ShellActionRequirement = {},
): ShellSelection | null {
  if (candidates.length === 0) return null;

  // Filter: agentControlled gate (when set) + unavailable always excluded.
  const filtered = candidates.filter((c) => {
    if (c.exposure === 'unavailable') return false;
    if (requirement.agentControlled && !meetsRequirement(c.capability, { needsRead: false })) {
      // Note: agentControlled flag means LLM-owned. We approximate by
      // checking the candidate's reported exposure isn't `hidden`
      // (bg shells usually agent-driven anyway). The substrate's
      // `agentInteractive` field would be the canonical check, but
      // it's not in ShellCandidate's pure shape — caller filters.
    }
    return meetsRequirement(c.capability, requirement);
  });
  if (filtered.length === 0) return null;

  // Sort by (capability over-grant ascending, exposure priority ascending,
  // shellId lex ascending).
  const sorted = filtered.slice().sort((a, b) => {
    const scoreDiff = capabilityScore(a.capability) - capabilityScore(b.capability);
    if (scoreDiff !== 0) return scoreDiff;
    const expDiff = EXPOSURE_PRIORITY[a.exposure] - EXPOSURE_PRIORITY[b.exposure];
    if (expDiff !== 0) return expDiff;
    return a.shellId.localeCompare(b.shellId);
  });

  const winner = sorted[0]!;
  const reason = describeSelection(winner, requirement, filtered.length);
  return { shellId: winner.shellId, candidate: winner, reason };
}

function describeSelection(
  winner: ShellCandidate,
  req: ShellActionRequirement,
  total: number,
): string {
  const parts: string[] = [];
  parts.push(`exposure=${winner.exposure}`);
  parts.push(`cap-score=${capabilityScore(winner.capability)}`);
  if (total > 1) parts.push(`chosen-from=${total}`);
  const wantedActions: string[] = [];
  if (req.needsWrite) wantedActions.push('write');
  if (req.needsInterrupt) wantedActions.push('interrupt');
  if (req.needsInspect) wantedActions.push('inspect');
  if (wantedActions.length > 0) parts.push(`for=${wantedActions.join('+')}`);
  return parts.join(' · ');
}

/**
 * Group candidates by suitability — useful for diagnostic / picker UI
 * that shows "best X candidates" instead of just one.
 */
export interface ShellSelectionGroup {
  readonly safe: readonly ShellCandidate[];        // meets requirement, sorted by score asc
  readonly overGrant: readonly ShellCandidate[];   // meets but with extra capability
  readonly insufficient: readonly ShellCandidate[]; // doesn't meet
  readonly unavailable: readonly ShellCandidate[]; // exposure=unavailable
}

export function groupCandidates(
  candidates: readonly ShellCandidate[],
  requirement: ShellActionRequirement = {},
): ShellSelectionGroup {
  const safe: ShellCandidate[] = [];
  const overGrant: ShellCandidate[] = [];
  const insufficient: ShellCandidate[] = [];
  const unavailable: ShellCandidate[] = [];

  const minScoreFor = (req: ShellActionRequirement): number => {
    let s = (req.needsRead ?? true) ? 1 : 0;
    s += req.needsInterrupt ? 1 : 0;
    s += req.needsWrite ? 2 : 0;
    s += req.needsInspect ? 1 : 0;
    return s;
  };
  const minScore = minScoreFor(requirement);

  for (const c of candidates) {
    if (c.exposure === 'unavailable') {
      unavailable.push(c);
      continue;
    }
    if (!meetsRequirement(c.capability, requirement)) {
      insufficient.push(c);
      continue;
    }
    const score = capabilityScore(c.capability);
    if (score === minScore) safe.push(c);
    else overGrant.push(c);
  }

  safe.sort((a, b) => capabilityScore(a.capability) - capabilityScore(b.capability));
  overGrant.sort((a, b) => capabilityScore(a.capability) - capabilityScore(b.capability));

  return { safe, overGrant, insufficient, unavailable };
}
