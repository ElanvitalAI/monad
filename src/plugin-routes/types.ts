// ── PX-5 P1: route types ──
//
// A route = declarative keyword → target mapping. Plugins contribute
// routes via manifest.contributes.routes[]; the RouteRegistry (below)
// compiles them into a lookup table used by:
//   1. The keyword detector (P3) — scans incoming user messages.
//   2. The `$name` explicit invocation parser (P3).
//   3. The Turn hook (P4) that injects a "Suggested routes" banner.
//
// DESIGN NOTE — route is ADVISORY, not autostart.
//   Route matching never directly spawns agents / runs workflows. It
//   only inserts a recommendation banner into the system prompt so
//   the LLM can decide. This keeps false-positive keyword matches
//   from triggering unintended subagent spawns.

export type RouteTargetKind = 'agent' | 'skill' | 'workflow' | 'mission';

export interface RouteTarget {
  kind: RouteTargetKind;
  /** Identifier of the target. For kind='agent' this is AgentDefinition
   *  .name (the same value Agent({subagent_type}) takes); for 'skill'
   *  it's the skill id as understood by the skill dispatcher; for
   *  'workflow' it's SkillWorkflow.id; for 'mission' it's
   *  MissionDefinition.id. */
  id: string;
}

export interface RouteContribution {
  /** Primary keyword + route id. Matches regex /^[a-z0-9][a-z0-9_-]{0,63}$/ */
  id: string;
  /** Additional keywords that match this route. Same regex as id. */
  aliases?: string[];
  target: RouteTarget;
  /** Lower = earlier on conflict. Default 100. 0-9 reserved for
   *  built-in routes (parser clamps non-builtin into 10+). */
  precedence?: number;
  /** When false, keyword match is case-sensitive. Default true. */
  caseInsensitive?: boolean;
  description?: string;
}

/** RouteContribution with plugin provenance + defaults resolved. The
 *  registry stores these; callers read them via list() / match(). */
export interface CompiledRoute extends RouteContribution {
  pluginId: string;
  compiledAt: number;
  precedence: number;           // default applied
  caseInsensitive: boolean;     // default applied
  /** Normalized keyword list — id + aliases, lowercased when
   *  caseInsensitive. Match logic scans against this field. */
  keywords: readonly string[];
}

/** Snapshot shape for `.monad/routes.json` (compiled cache). */
export interface RoutesCompiledFile {
  schemaVersion: 1;
  generatedAt: number;
  routes: CompiledRoute[];
}

export const ROUTE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const ROUTE_DEFAULTS = {
  precedence: 100,
  reservedPrecedenceMax: 9,     // 0-9 reserved for builtins
  caseInsensitive: true,
  maxAliasesPerRoute: 15,
  maxKeywordsPerRegistry: 500,
  bannerMaxSuggestions: 5,
} as const;
