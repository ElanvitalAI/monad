// ── VW-term-infra Phase 3a — Layout public API ──
//
// Consolidated surface for the serializable layout layer. Consumers
// (Phase 5 SaveLayout / LoadLayout LLM tools, `^B L s/l/p` chord
// family, Phase 3b surface-promote restore path, the Capture arc
// snapshot embed) all import from here.
//
// Runtime binary-tree ops continue to live at ../layout-tree.ts — this
// module is strictly the *persistable* spec layer plus its adapter.

export {
  LAYOUT_SPEC_VERSION,
  LayoutSpecValidationError,
  type LayoutSpec,
  type LayoutSpecNode,
} from './types.js';

export {
  fromJson,
  toJson,
  validateSpec,
} from './serializer.js';

export {
  deleteLayoutSpec,
  layoutsDir,
  listLayoutSpecs,
  loadLayoutSpec,
  loadLayoutSpecFromPath,
  resolveLayoutArtifactPath,
  saveLayoutSpec,
  slugify,
  specSlug,
  type LayoutListResult,
  type LayoutPersistenceOpts,
  type SaveLayoutSpecOpts,
  type SavedLayoutListing,
  type SkippedLayoutListing,
} from './persistence.js';

export {
  buildPreset,
  presetArity,
  LAYOUT_PRESET_NAMES,
  type LayoutPresetName,
} from './presets.js';

export {
  fromBinaryTree,
  toBinaryTree,
} from './tree.js';

export {
  planRestore,
  snapshotWindow,
  type FloatPlanEntry,
  type RestorePlan,
  type RestorePlanInput,
  type TabsPlanEntry,
} from './restore-planner.js';

export {
  applyLayoutPlan,
  computeApplyActions,
  type ApplyLayoutResult,
  type LayoutApplyAction,
  type LayoutApplyExecutor,
} from './apply-planner.js';
