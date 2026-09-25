// W6 Z9 · pure reducer · 3 lane output → SMART goal + constraints.
// Cf. ROADMAP §4 Z9. Pure so the showroom controller stays the single
// mutation site (`feedback_presentation_no_content_mutation`).

import type { ShowroomLaneOutput } from '../task-orchestrator/surfaces/showroom-surface.js';
import type { GoalEnhanceLaneRole } from './goal-enhance-showroom.js';

export interface EnhancedGoal {
  /** Original user goal verbatim. */
  goal: string;
  /** Clarifier + outcome merged · falls back to `goal` when reducer didn't run. */
  smartGoal: string;
  constraints: string[];
  outcome?: string;
}

function trim(s: string): string {
  return s.replace(/^\s+|\s+$/g, '');
}

function firstParagraph(text: string): string {
  const para = text.split(/\n\s*\n/)[0] ?? text;
  return trim(para);
}

function extractConstraints(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const bullets: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-•*]\s+(.*)$/);
    if (m && m[1]) {
      const item = trim(m[1]);
      if (item.length > 0) bullets.push(item);
      if (bullets.length >= 5) break;
    }
  }
  if (bullets.length > 0) return bullets;
  // Fallback — non-bulleted lines, up to 5.
  return lines.map(trim).filter((l) => l.length > 0).slice(0, 5);
}

export function reduceEnhancement(
  rawGoal: string,
  lanes: Array<{ role: GoalEnhanceLaneRole; out: ShowroomLaneOutput }>,
): EnhancedGoal {
  const byRole = new Map<GoalEnhanceLaneRole, string>();
  for (const l of lanes) byRole.set(l.role, l.out.text);

  const clarifier = byRole.get('clarifier');
  const outcomeRaw = byRole.get('outcome-definer');
  const constraintsRaw = byRole.get('constraint-surfacer');

  const smartGoal = clarifier && outcomeRaw
    ? `${firstParagraph(clarifier)}\n\nOutcome: ${firstParagraph(outcomeRaw)}`
    : (clarifier ? firstParagraph(clarifier) : rawGoal);

  return {
    goal: rawGoal,
    smartGoal,
    constraints: constraintsRaw ? extractConstraints(constraintsRaw) : [],
    ...(outcomeRaw ? { outcome: firstParagraph(outcomeRaw) } : {}),
  };
}
