// ── VW-term-infra Bundle B-2 · P6-1 — Artifact meta sidecar ──
//
// JSON sidecar format · one file per artifact at `<path>.meta.json`.
// Schema mirrors `ArtifactMeta` exactly · unknown fields are preserved
// on round-trip so future kinds can add fields without breaking
// existing readers (forward-compat).
//
// Only pure encode/decode here · fs I/O lives in `store.ts` (testable
// with a single fs injection point).

import type { ArtifactKind, ArtifactMeta } from './types.js';
import { ARTIFACT_KINDS } from './types.js';

export class ArtifactMetaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactMetaParseError';
  }
}

/** Serialize to a stable-key JSON string. 2-space indent for
 *  git-diff friendliness. Ordered keys so sidecars survive rewrite
 *  without spurious diffs. */
export function encodeMeta(meta: ArtifactMeta): string {
  const ordered: Record<string, unknown> = {
    kind: meta.kind,
    origin: meta.origin,
    createdAt: meta.createdAt,
  };
  if (meta.sizeBytes !== undefined) ordered.sizeBytes = meta.sizeBytes;
  if (meta.description !== undefined) ordered.description = meta.description;
  if (meta.tags !== undefined) ordered.tags = [...meta.tags];
  if (meta.producer !== undefined) ordered.producer = meta.producer;
  if (meta.extra !== undefined) ordered.extra = { ...meta.extra };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Parse a meta sidecar. Throws ArtifactMetaParseError with a helpful
 *  message on malformed JSON / missing required fields / unknown
 *  kind. Callers should catch + skip (list) or re-throw (get). */
export function decodeMeta(raw: string): ArtifactMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ArtifactMetaParseError(
      `meta JSON malformed: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ArtifactMetaParseError('meta must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.kind !== 'string' || !ARTIFACT_KINDS.includes(obj.kind as ArtifactKind)) {
    throw new ArtifactMetaParseError(`unknown kind ${String(obj.kind)}`);
  }
  if (typeof obj.origin !== 'string' || obj.origin.length === 0) {
    throw new ArtifactMetaParseError('origin must be a non-empty string');
  }
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) {
    throw new ArtifactMetaParseError('createdAt must be a finite number');
  }
  const meta: ArtifactMeta = {
    kind: obj.kind as ArtifactKind,
    origin: obj.origin,
    createdAt: obj.createdAt,
    ...(typeof obj.sizeBytes === 'number' ? { sizeBytes: obj.sizeBytes } : {}),
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    ...(Array.isArray(obj.tags)
      ? { tags: obj.tags.filter((t): t is string => typeof t === 'string') }
      : {}),
    ...(typeof obj.producer === 'string' ? { producer: obj.producer } : {}),
    ...(obj.extra && typeof obj.extra === 'object' && !Array.isArray(obj.extra)
      ? { extra: obj.extra as Record<string, unknown> }
      : {}),
  };
  return meta;
}
