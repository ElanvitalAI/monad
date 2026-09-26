// ── VW-term-infra Bundle B-2 · P6-1 — Artifact types ──
//
// Canonical shape for any persisted output artifact monad-agent
// produces. The unified store (`src/artifact/store.ts`) organises
// them under `~/.elanous/artifacts/<kind>/<ts>-<origin>.<ext>` with a
// JSON sidecar carrying provenance.
//
// `ArtifactKind` is a closed discriminator — new kinds require a
// deliberate addition (prevents ad-hoc directory sprawl under
// `artifacts/`). Extension-on-disk is derived per-kind via
// `paths.ts#extensionFor(kind, overrides)` · some kinds (capture)
// want user control of the extension so the field is overridable.

/** Canonical artifact kinds. Add here → paths.ts `DEFAULT_EXTENSIONS`
 *  → store kind-check. Out-of-scope kinds live in their own stores
 *  (e.g. hooks-log · cost-events · plugin state). */
export type ArtifactKind =
  | 'timeline'
  | 'layout'
  | 'capture'
  | 'block'
  | 'attachment';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = Object.freeze([
  'timeline',
  'layout',
  'capture',
  'block',
  'attachment',
]);

/** Metadata sidecar. Serialised as JSON next to the artifact body.
 *  `createdAt` is the authoritative write time (server-side clock · ms
 *  since epoch). `producer` ties an artifact back to the bundle /
 *  skill / plugin that emitted it. `tags` is free-form for the
 *  eventual artifact-browser widget to filter by. */
export interface ArtifactMeta {
  readonly kind: ArtifactKind;
  readonly origin: string;
  readonly createdAt: number;
  readonly sizeBytes?: number;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly producer?: string;
  readonly extra?: Record<string, unknown>;
}

/** Input shape for `put()`. `kind` + `createdAt` are added by the
 *  store itself so callers never forge them. */
export type ArtifactPutMeta = Omit<ArtifactMeta, 'kind' | 'createdAt'>;

/** Full artifact read back from disk. `body` is the raw serialised
 *  form; callers decode per-kind. */
export interface Artifact {
  readonly path: string;
  readonly metaPath: string;
  readonly meta: ArtifactMeta;
  readonly body: string | Buffer;
}

/** Lightweight handle returned by `put()`. Skip body load when caller
 *  only needs the path + meta. */
export interface ArtifactHandle {
  readonly path: string;
  readonly metaPath: string;
  readonly meta: ArtifactMeta;
}

/** Listing entry — `list()` returns these without loading bodies. */
export interface ArtifactListing {
  readonly path: string;
  readonly meta: ArtifactMeta;
}

/** Store lifecycle events — subscribers receive these for cache
 *  invalidation + live UI refresh (artifact-browser widget). */
export type ArtifactEvent =
  | { readonly kind: 'put';    readonly handle: ArtifactHandle }
  | { readonly kind: 'remove'; readonly path: string };
