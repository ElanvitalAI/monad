// ── IUL-shared prompt builder ─────────────────────────────────
//
// Scenario-agnostic helpers for building catalog summaries + system
// prompts that drive the materialize() pipeline. Scenario-specific
// wrappers (iul-canvas buildSystemPrompt, future iul-speech, …) compose
// these with their own pattern → widget mapping strings.
//
// Keep pure — no runtime, no LLM calls, no file I/O. Import-safe from
// any scenario plugin or from the Phase L MaterializeFromIntent tool.

import type { WidgetDef } from '../../src/widgets/types.js';

export interface CatalogEntry {
  type: string;
  description: string;
}

/** Project a WidgetDef list down to {type, description} pairs. Optional
 *  skipTypes filter lets scenarios exclude themselves (e.g. iul-canvas
 *  passes `['iul-canvas']` so the LLM never spawns a canvas inside
 *  a canvas). */
export function buildCatalogSummary(
  defs: readonly WidgetDef[],
  skipTypes: readonly string[] = [],
): CatalogEntry[] {
  const skip = new Set(skipTypes);
  return defs
    .filter((d) => !skip.has(d.type))
    .map((d) => ({ type: d.type, description: d.description }));
}

/** Render the catalog list section that every IUL system prompt
 *  embeds. Fixed format across scenarios = prompt-cache friendly. */
export function renderCatalogList(catalog: readonly CatalogEntry[]): string {
  if (catalog.length === 0) {
    return '(no widgets registered — return widgetType:"markdown")';
  }
  return catalog.map((e) => `  - ${e.type}: ${e.description}`).join('\n');
}

export interface GenericSystemPromptOpts {
  catalog: readonly CatalogEntry[];
  /** Short sentence describing where the intent came from — e.g.
   *  "a sketch of shapes on a braille canvas" or "a natural-language
   *  description of a data view". Appears in the opening paragraph. */
  intentSource: string;
  /** Scenario-specific pattern → widget mapping. Free-form text
   *  embedded between the catalog and the JSON shape. Empty string =
   *  skip the pattern block (iul-speech may not need visual patterns). */
  patterns?: string;
  /** Extra rules appended after the JSON shape. Free-form. Used for
   *  scenario-specific constraints (e.g. "iul-canvas: don't pick
   *  iul-canvas as the output type" is already enforced by catalog
   *  filter, but additional rules live here). */
  extraRules?: string;
}

/** Build a generic IUL system prompt. Scenario-specific wrappers
 *  compose this with their own `patterns` / `extraRules` strings.
 *  Output contains the fixed JSON-shape block + catalog list + the
 *  default rules (widgetType-in-catalog, fallback to markdown, etc). */
export function buildGenericSystemPrompt(opts: GenericSystemPromptOpts): string {
  const catalogList = renderCatalogList(opts.catalog);
  const patternsBlock = opts.patterns && opts.patterns.length > 0
    ? `\n${opts.patterns}\n`
    : '\n';
  const extraRulesBlock = opts.extraRules && opts.extraRules.length > 0
    ? `\n  ${opts.extraRules}`
    : '';

  return `You are an IUL (Intelligent UX Lab) widget materializer.

You receive ${opts.intentSource}. Pick the widget that best matches
the user's intent and return a JSON spec that spawns it.

Available widget types (catalog):
${catalogList}
${patternsBlock}Return EXACTLY this JSON shape, no prose, no code fence, no commentary:

{
  "widgetType": "<one of the catalog types above>",
  "config": { ... },
  "character": "<short title for the widget pane>",
  "reason": "<one sentence explaining the choice>",
  "confidence": <number between 0 and 1>
}

Rules:
  - widgetType MUST appear in the catalog above. If unsure, pick "markdown".
  - config MAY be empty {} — the widget will use its defaults.
  - confidence < 0.5 means you couldn't tell; the user gets a warning.
  - reason is shown to the user verbatim — keep it short and useful.${extraRulesBlock}`;
}
