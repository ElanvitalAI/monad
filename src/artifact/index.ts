// ── Artifact module · public API barrel ─────────────────────────
//
// VW-term-infra Bundle B-2 · P6-1. Unified artifact persistence
// layer under `~/.monad/artifacts/<kind>/`. Migration of existing
// scattered paths (timelines / layouts / blocks / captures) lands in
// Bundle B-3 (P6-2).

export {
  ARTIFACT_KINDS,
  type Artifact,
  type ArtifactEvent,
  type ArtifactHandle,
  type ArtifactKind,
  type ArtifactListing,
  type ArtifactMeta,
  type ArtifactPutMeta,
} from './types.js';

export {
  DEFAULT_EXTENSIONS,
  defaultArtifactBaseDir,
  directoryFor,
  metaPathFor,
  resolveArtifactPath,
  sanitizeOrigin,
  timestampSlug,
  type ResolveArtifactPathOpts,
} from './paths.js';

export {
  decodeMeta,
  encodeMeta,
  ArtifactMetaParseError,
} from './meta.js';

export {
  createArtifactStore,
  type ArtifactFs,
  type ArtifactStore,
  type ArtifactStoreDeps,
  type PutOpts,
} from './store.js';

export {
  mergeLegacyListings,
  type LegacyArtifactProvider,
  type LegacyProviderFs,
} from './legacy-provider.js';

export {
  createLegacyTimelineProvider,
  type LegacyTimelineOriginPatterns,
  type LegacyTimelineProviderOpts,
} from './providers/legacy-timeline.js';

export {
  createLegacyLayoutProvider,
  type LegacyLayoutProviderFs,
  type LegacyLayoutProviderOpts,
} from './providers/legacy-layout.js';
