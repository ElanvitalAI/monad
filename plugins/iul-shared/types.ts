// ── IUL-shared types ──────────────────────────────────────────
//
// Scenario-agnostic types shared across IUL scenario plugins
// (iul-canvas, future iul-speech, iul-mermaid, …) and the Phase L
// `MaterializeFromIntent` LLM tool. Scenario-specific structures
// (SketchJSON, transcripts, …) stay in each scenario's own types.ts.

/** What the LLM returns from a materialize() round-trip. Validated
 *  before being passed to widgetHost.spawn. Unknown optional fields
 *  are dropped by `validateWidgetSpec`. */
export interface WidgetSpec {
  /** Must already be registered with widget-host. The materializer
   *  rejects unknown types with a fader warning. */
  widgetType: string;
  /** Passed to `WidgetDef.initialState(config)`. */
  config?: Record<string, unknown>;
  /** Title shown in the spawned widget's pane. */
  character?: string;
  /** 1-line natural language explanation — surfaced through the fader
   *  HUD so the user can see why the LLM picked this widget. */
  reason: string;
  /** [0, 1] — the LLM's self-reported confidence. < 0.5 surfaces a
   *  warning banner asking the user to confirm. */
  confidence: number;
}
