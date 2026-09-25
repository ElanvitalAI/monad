// ── Presentation P3 · WidgetSchemaRegistry ──
//
// Central registry that maps widget `type` → JSONSchema. The registry
// is the single source of truth for:
//   - `GetWidgetSchema({type})` LLM tool — lookups.
//   - `decodeWidgetTree(json | yaml)` pipeline — config validation.
//
// Widgets can self-register via their `schema()` hook (widget-types.ts
// `Widget.schema`). Widgets without a schema fall back to a permissive
// generic schema so unregistered widgets aren't invisible to the tool
// surface — they just accept any config shape.
//
// Registry state is process-global by design: a single dashboard has
// one widget-host + one schema registry. Tests may call
// `_resetWidgetSchemaRegistryForTest` to start fresh.

export interface WidgetSchemaEntry {
  /** Widget `type` string — unique identifier. */
  readonly type: string;
  /** Human-readable description · mirrors WidgetDef.description. */
  readonly description: string;
  /** JSONSchema for the widget's config object. `additionalProperties`
   *  should be `false` so unknown fields surface during validation. */
  readonly configSchema: Record<string, unknown>;
  /** Optional JSONSchema for `state`. Most consumers only care about
   *  config; state is exposed for introspection tools that want to
   *  round-trip recorded snapshots. */
  readonly stateSchema?: Record<string, unknown>;
  /** Whether the widget accepts a `style.decoration` (BoxDecoration)
   *  field · `true` when the widget's renderer honors it. Defaults to
   *  `false` until P4 Chrome wires up support. */
  readonly decorationSupported?: boolean;
}

const registry = new Map<string, WidgetSchemaEntry>();

/** Register a widget's schema · idempotent (same type re-registers with
 *  the new entry). Returns a dispose function that unregisters the
 *  entry — useful for plugin lifecycle (uninstall on deactivate). */
export function registerWidgetSchema(entry: WidgetSchemaEntry): () => void {
  if (!entry.type || typeof entry.type !== 'string') {
    throw new Error('registerWidgetSchema: entry.type must be a non-empty string');
  }
  registry.set(entry.type, entry);
  return () => {
    // Only remove if this same entry is still registered (protect
    // against races where another registration replaced ours).
    if (registry.get(entry.type) === entry) registry.delete(entry.type);
  };
}

/** Lookup · returns the entry or a permissive generic fallback.
 *  The fallback lets unregistered widgets still participate in decode
 *  + tool dispatch; config is accepted as-is without validation. */
export function getWidgetSchema(type: string): WidgetSchemaEntry {
  const hit = registry.get(type);
  if (hit) return hit;
  return {
    type,
    description: `(generic) no schema registered for widget type "${type}"`,
    configSchema: {
      type: 'object',
      additionalProperties: true,
    },
    decorationSupported: false,
  };
}

/** Return true when an explicit schema is registered for `type` (i.e.
 *  `getWidgetSchema` would return a real entry rather than the
 *  permissive fallback). */
export function hasWidgetSchema(type: string): boolean {
  return registry.has(type);
}

/** Snapshot of every registered type. Sorted alphabetically so LLM
 *  output is stable across runs. */
export function listWidgetSchemas(): readonly WidgetSchemaEntry[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/** Test-only · clear the registry. Production code must never call
 *  this — it would erase plugin-contributed schemas and break tool
 *  dispatch. Named with the underscore prefix by convention. */
export function _resetWidgetSchemaRegistryForTest(): void {
  registry.clear();
}

/** Minimal shape of a widget definition that this harvester reads —
 *  purposefully narrower than the full `WidgetDef` / `Widget<S,C>`
 *  interface to avoid a cyclic import into `widget-types.ts`. */
export interface HarvestableWidgetDef {
  readonly type: string;
  readonly description: string;
  configSchema?(): Record<string, unknown>;
}

/** Harvest a widget def's `configSchema()` hook and register it. No-op
 *  when the def omits the hook. Returns a disposer that unregisters
 *  the entry (symmetric to `registerWidgetSchema`). */
export function harvestWidgetSchema(
  def: HarvestableWidgetDef,
  opts: { decorationSupported?: boolean } = {},
): (() => void) | null {
  if (typeof def.configSchema !== 'function') return null;
  const entry: WidgetSchemaEntry = {
    type: def.type,
    description: def.description,
    configSchema: def.configSchema(),
    decorationSupported: opts.decorationSupported ?? false,
  };
  return registerWidgetSchema(entry);
}
