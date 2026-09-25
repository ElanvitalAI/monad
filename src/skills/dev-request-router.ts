// ── Development-request router (deterministic, pre-LLM) ────────────────
//
// A deliberately conservative pure detector. It only identifies explicit
// implementation requests; uncertain language returns null for the LLM turn.

import { debug } from '../debug/log.js';

/** Structural subset of `user-config`'s `skills.devRequestRouting`. */
export interface DevRequestRoutingConfig {
  /** Master switch. Off → detectDevRequest always returns null. */
  enabled: boolean;
  /** Explicit implementation verbs that can activate the route. */
  verbs: string[];
  /** Any guard suppresses the route and defers to the LLM. */
  guardKeywords: string[];
}

export interface DevRequestDecision {
  /** The explicit implementation verb that activated this decision. */
  verb: string;
  /** A non-verb target token found with the verb. */
  target: string;
  /** Short human/observability reason. */
  reason: string;
}

function containsAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    const normalized = (needle ?? '').toLowerCase().trim();
    if (normalized && haystack.includes(normalized)) return needle;
  }
  return null;
}

/**
 * Detect an unambiguous development request without touching disk, network,
 * or an LLM. It returns null for disabled routing, guards, missing explicit
 * verbs, and requests that lack a plausible implementation target.
 */
export function detectDevRequest(
  text: string,
  cfg: DevRequestRoutingConfig,
): DevRequestDecision | null {
  if (!cfg.enabled || !text || !text.trim()) return null;

  const haystack = text.toLowerCase();
  if (containsAny(haystack, cfg.guardKeywords)) return null;

  const verb = containsAny(haystack, cfg.verbs);
  if (!verb) return null;

  const target = text
    .replace(new RegExp(escapeRegExp(verb), 'i'), ' ')
    .replace(/[.?!,;:]+/g, ' ')
    .trim()
    .split(/\s+/)
    .find((token) => token.length > 1 && !isPoliteSuffix(token));
  if (!target) return null;

  return {
    verb,
    target,
    reason: `explicit development verb "${verb}" with target "${target}"`,
  };
}

/**
 * Call this at a pre-turn surface boundary. Keeping it separate from
 * detectDevRequest preserves the detector's side-effect-free contract.
 */
export interface DevRequestRouteObservation {
  surface?: string;
}

export function observeDevRequestRoute(
  text: string,
  cfg: DevRequestRoutingConfig,
  detected: DevRequestDecision | null = detectDevRequest(text, cfg),
  observation: DevRequestRouteObservation = {},
): DevRequestDecision | null {
  const decision = detected;
  debug.log('skills.dev-route', decision ? 'would-route' : 'not-routed', {
    surface: observation.surface,
    decision: decision !== null,
    configEnabled: cfg.enabled,
    routed: false,
    routingAction: 'none',
    reason: decision?.reason ?? routeDeferralReason(text, cfg),
    matchedWords: decision ? { verb: decision.verb, target: decision.target } : {},
  });
  return decision;
}

/** Observes without ever changing the caller's message-processing path. */
export function observeDevRequestRouteFailSoft(
  text: string,
  cfg: DevRequestRoutingConfig,
  observation: DevRequestRouteObservation,
): void {
  try {
    observeDevRequestRoute(text, cfg, undefined, observation);
  } catch (error) {
    try {
      debug.log('skills.dev-route', 'observation-error', {
        surface: observation.surface,
        error: (error as Error)?.message ?? String(error),
      }, { level: 'error' });
    } catch {
      // Logging must not interrupt the caller's existing message path.
    }
  }
}

function routeDeferralReason(text: string, cfg: DevRequestRoutingConfig): string {
  if (!cfg.enabled) return 'disabled';
  if (!text.trim()) return 'empty-input';
  const haystack = text.toLowerCase();
  const guard = containsAny(haystack, cfg.guardKeywords);
  if (guard) return `guard "${guard}"`;
  if (!containsAny(haystack, cfg.verbs)) return 'no-explicit-development-verb';
  return 'no-implementation-target';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPoliteSuffix(token: string): boolean {
  return /^(네가|좀|이거|그거|이번엔|한|방에|더|잘|안|되게)$/u.test(token);
}
