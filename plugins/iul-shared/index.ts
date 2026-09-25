// ── IUL-shared public barrel ──────────────────────────────────
//
// Single import point for scenario plugins + the Phase L
// `MaterializeFromIntent` LLM tool.

export {
  buildCatalogSummary,
  buildGenericSystemPrompt,
  renderCatalogList,
  type CatalogEntry,
  type GenericSystemPromptOpts,
} from './prompt.js';

export {
  materialize,
  parseWidgetSpec,
  specTypeInCatalog,
  validateWidgetSpec,
  type MaterializeOpts,
} from './materializer.js';

export type { WidgetSpec } from './types.js';
