// ── Presentation P5a · Scenario catalog types ──
//
// A `Scenario` is a declarative recipe that names a layout of widgets +
// per-widget decoration. Catalog loads YAML files from a directory
// (`scenarios/*.yaml`) and exposes them as a Map<id, ScenarioDef>.
// Materialization hands the layout to `decodeWidgetTree` so every
// scenario runs through the same validate + decorate pipeline the rest
// of the codebase uses.
//
// The `layout` field is deliberately typed as `unknown` — we don't re-
// declare every `WidgetSpec` shape here. `decodeWidgetTree` enforces
// structure at materialize time · invalid scenarios report errors.

export interface ScenarioDef {
  /** Unique identifier · matches filename by convention (but not
   *  enforced — id overrides filename). */
  readonly id: string;
  /** Short one-line title for LLM + Playground UIs. */
  readonly title: string;
  /** Longer description · what the scenario is for + when to use. */
  readonly description?: string;
  /** Widget tree payload handed to `decodeWidgetTree`. Accepts every
   *  shape the decoder accepts (single node · top-level array ·
   *  `layout` wrapper · `widgets` wrapper). */
  readonly layout: unknown;
  /** Optional extra metadata for tooling (tags · version · author).
   *  Pass-through · not inspected by the catalog. */
  readonly meta?: Record<string, unknown>;
}

/** Per-scenario error entry from `loadScenarioCatalog`. */
export interface ScenarioLoadError {
  /** Absolute path to the offending file, or `<dir>` when the directory
   *  itself couldn't be scanned. */
  readonly path: string;
  /** Human-readable reason. */
  readonly message: string;
}

export interface ScenarioCatalog {
  /** Loaded scenario definitions keyed by `id`. Insertion order follows
   *  directory listing (sorted by filename). Duplicate ids are handled
   *  per `loadScenarioCatalog` `onDuplicate` policy. */
  readonly scenarios: ReadonlyMap<string, ScenarioDef>;
  /** Files that failed to load + parse + validate. Empty when the
   *  directory loads cleanly. Catalog is still usable — the scenarios
   *  that DID load are in `scenarios`. */
  readonly errors: readonly ScenarioLoadError[];
}
