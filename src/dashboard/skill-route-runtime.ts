import type { SkillTier } from '../skills/runner.js';
import {
  shouldAutoRoute,
  type DetectResult,
} from '../skills/router.js';

export interface DashboardSkillRouteRuntimeOptions {
  autoRouteEnabled: boolean;
  autoRouteMinScore: number;
  requireAutoTrigger: boolean;
  activeTier: SkillTier;
  declinedTop: boolean;
}

export type DashboardSkillRouteDecision =
  | { kind: 'none' }
  | { kind: 'auto'; target: string }
  | { kind: 'confirm'; target: string };

export function formatDashboardSkillHint(detection: DetectResult): string | null {
  const top = detection.top;
  if (!top) return null;
  const hasExplicit = top.matchedTriggers.length > 0;
  const hasExtracted = top.matchedExtractedTriggers.length > 0;
  if (!hasExplicit && !hasExtracted) return null;
  const label = hasExplicit ? 'matched' : 'matched~';
  const picks = (hasExplicit ? top.matchedTriggers : top.matchedExtractedTriggers).slice(0, 3);
  if (detection.unambiguous) {
    return `  hint: /run-skill ${top.name}  (${label}: ${picks.join(', ')})`;
  }
  return `  hint: /run-skill ${top.name}  (ambiguous — also: ${detection.candidates.slice(1, 3).map(c => c.name).join(', ')})`;
}

export function resolveDashboardSkillRouteDecision(
  detection: DetectResult,
  opts: DashboardSkillRouteRuntimeOptions,
): DashboardSkillRouteDecision {
  const top = detection.top;
  if (!top || opts.declinedTop) return { kind: 'none' };
  const autoOK = shouldAutoRoute(detection, {
    autoRouteEnabled: opts.autoRouteEnabled,
    minScore: opts.autoRouteMinScore,
    requireAutoTrigger: opts.requireAutoTrigger,
    activeTier: opts.activeTier,
  });
  if (autoOK) return { kind: 'auto', target: top.name };

  const hasExplicit = top.matchedTriggers.length > 0;
  const hasExtracted = top.matchedExtractedTriggers.length > 0;
  if (
    opts.autoRouteEnabled &&
    detection.unambiguous &&
    (hasExplicit || hasExtracted)
  ) {
    return { kind: 'confirm', target: top.name };
  }
  return { kind: 'none' };
}
