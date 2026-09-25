// ── Branded URI types — compile-only tags over plain strings ──
//
// PLAN §7.4 · DD-MSS-24 — a `MonadUri` is a `string`, but one that survived
// a runtime validation step. The brand is a `unique symbol` phantom field
// so a raw `string` can't be passed where a `MonadUri` is expected without
// going through `asMonadUri()` (or one of the `asX` helpers in builder.ts).
//
// No zod dependency — the brand is pure TypeScript.

declare const MonadUriBrand: unique symbol;
declare const SessionUriBrand: unique symbol;
declare const AgentUriBrand: unique symbol;
declare const MemoryUriBrand: unique symbol;
declare const SignalUriBrand: unique symbol;
declare const TurnUriBrand: unique symbol;
declare const RunUriBrand: unique symbol;
declare const PluginUriBrand: unique symbol;
declare const WidgetUriBrand: unique symbol;
declare const ModalUriBrand: unique symbol;
declare const TraceIdBrand: unique symbol;
declare const SpanIdBrand: unique symbol;

/** Full `monad://` URI (any Tier). Every `X Uri` subtype is assignable to
 *  `MonadUri`, so generic helpers accept the broadest type. */
export type MonadUri = string & { readonly [MonadUriBrand]: true };

export type SessionUri = MonadUri & { readonly [SessionUriBrand]: true };
export type AgentUri = MonadUri & { readonly [AgentUriBrand]: true };
export type MemoryUri = MonadUri & { readonly [MemoryUriBrand]: true };
export type SignalUri = MonadUri & { readonly [SignalUriBrand]: true };

/** Per-turn stable identifier (M1.2). A `TurnUri` is a `string` brand, not a
 *  `MonadUri` subtype, because SAM S0 persists the bare 26-char ULID form
 *  (`<ULID>`) rather than the Tier 2 `turn/<ULID>` path. `asTurnUri()` is
 *  lenient — it accepts either the bare ULID or a `turn/<ULID>` MonadUri
 *  segment — while `mintTurnUri()` emits the bare form to preserve the
 *  existing JSONL wire format. */
export type TurnUri = string & { readonly [TurnUriBrand]: true };

/** TOX run lifecycle identifier (M1.2 · agentic-flow P0-A). A `RunUri` IS a
 *  `MonadUri` — runs are fresh-from-scratch entities with no legacy wire
 *  format to preserve, so the canonical Tier 2 `run/<ULID>` shape applies. */
export type RunUri = MonadUri & { readonly [RunUriBrand]: true };

/** Plugin activation identifier (M1.2). A `PluginUri` is a `MonadUri` —
 *  it identifies a *specific activation* of a plugin (since plugins can
 *  be reactivated within a session). The plugin manifest's slug `id`
 *  stays a plain string at the wire boundary (DD-MSS-38). */
export type PluginUri = MonadUri & { readonly [PluginUriBrand]: true };

/** Widget instance identifier (M1.2). A `WidgetUri` is a `MonadUri` —
 *  it identifies a single live `WidgetInstance` rather than the
 *  `WidgetDef` it spawned from. The `WidgetInstance.id` slug
 *  ("skills-1", "chart-px") stays a plain string for layout-host
 *  bookkeeping. */
export type WidgetUri = MonadUri & { readonly [WidgetUriBrand]: true };

/** Modal handle identifier (M1.2). A `ModalUri` is a `MonadUri` — it
 *  identifies a single live `ModalHandle` (one push). The legacy
 *  `<typeName>#g<generation>` surface id stays the coordinator's key;
 *  `modalUri` is the typed handle MSS bridges reference. */
export type ModalUri = MonadUri & { readonly [ModalUriBrand]: true };

/** 26-char ULID that identifies a trace (turn-level root span). PLAN §9.6.5. */
export type TraceId = string & { readonly [TraceIdBrand]: true };
/** 26-char ULID that identifies a child span within a trace. */
export type SpanId = string & { readonly [SpanIdBrand]: true };

/** Entity kinds accepted by the URI grammar (PLAN §7.1). Keep in sync with
 *  the grammar union — adding a new kind here requires updating the parser
 *  valid-kinds check as well. */
export const ENTITY_KINDS = [
  'agent', 'session', 'window', 'term', 'msg',
  'modal', 'widget', 'popover', 'block', 'task',
  'sensory', 'stm', 'ltm', 'signal', 'log', 'trace',
  'span', 'skill', 'tool-call', 'plugin', 'scheduler-job',
  'pack', 'card', 'turn', 'run',
] as const;

export type EntityKind = typeof ENTITY_KINDS[number];

export function isEntityKind(s: string): s is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(s);
}

/** Tier 1 short-form abbreviations. PLAN §7.0 examples (`ses_…`, `sig_…`)
 *  rely on these. The map is bijective — each canonical kind has at most
 *  one abbreviation. Kinds not listed here simply round-trip under their
 *  full spelling in Tier 1 form. */
export const TIER1_ABBREVIATIONS: Readonly<Record<string, EntityKind>> = Object.freeze({
  ses: 'session',
  sig: 'signal',
  agt: 'agent',
  sns: 'sensory',
  sch: 'scheduler-job',
  tlc: 'tool-call',
});

/** Reverse lookup — canonical kind → abbreviation, if any. */
export const TIER1_ABBREV_REVERSE: Readonly<Partial<Record<EntityKind, string>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TIER1_ABBREVIATIONS).map(([a, k]) => [k, a]),
  ) as Partial<Record<EntityKind, string>>,
);

/** Resolve a token from a Tier 1 short form to its canonical EntityKind.
 *  Accepts either the full kind or an abbreviation. Returns null if neither. */
export function resolveTier1Kind(token: string): EntityKind | null {
  if (isEntityKind(token)) return token;
  const abbrev = TIER1_ABBREVIATIONS[token];
  return abbrev ?? null;
}

/** Unchecked brand cast. Unlike `asSessionUri()` this does NOT validate —
 *  it is the type-level equivalent of trust-me-bro, intended for the
 *  narrow set of sites that already KNOW their input is a session
 *  identifier but pre-date the M1.1 URI migration (legacy on-disk
 *  strings, ACP protocol strings received over the wire, string ids in
 *  dual-role-manager records that have not yet been migrated in the
 *  downstream Phase B3 PR). The brand is a phantom type with no runtime
 *  cost, so threading it through type-only boundaries is zero-risk.
 *
 *  New code that mints a session should use `mintSessionUri()` from
 *  `session-mint.ts`; code that validates untrusted input at a system
 *  boundary should use `asSessionUri()` from `builder.ts`. Use this
 *  helper only when the two above are inappropriate. */
export function unsafeBrandSessionUri(s: string): SessionUri {
  return s as SessionUri;
}
