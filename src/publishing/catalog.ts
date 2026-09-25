import type { StoredDocument } from './artifact-store.js';
import {
  PERMANENT_EXPIRES_AT,
  type CatalogMeta,
  type PublishId,
  type PublishManifest,
  type PublishTarget,
} from './types.js';

/** Public projection of a published document used by the content feed. */
export interface CatalogRecord extends Partial<CatalogMeta> {
  readonly id: PublishId;
  readonly url: string;
  readonly title: string;
  readonly createdAt: string;
}

/** Deterministic public-URL preference — cloudfront(CDN) over funnel; never insertion order. */
const TARGET_PRIORITY: readonly PublishTarget[] = ['cloudfront', 'funnel'];

/** Selects the public URL for a manifest by explicit target priority (not object insertion order). */
function selectPublicUrl(manifest: PublishManifest): string | null {
  for (const target of TARGET_PRIORITY) {
    const meta = manifest.targets[target];
    if (meta) return meta.url;
  }
  return null;
}

/** True when a manifest is expired at `now`. Permanent far-future never expires; an unparsable
 *  `expiresAt` is treated as expired (fail-safe — never expose a document of unknown lifecycle). */
function isExpired(manifest: PublishManifest, now: number): boolean {
  if (manifest.expiresAt === PERMANENT_EXPIRES_AT) return false;
  const expiresAt = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt < now;
}

/**
 * Projects non-expired published documents into a newest-first public catalog.
 * Documents without any published target are skipped (no public URL to link).
 * `now` is injectable for deterministic boundary testing; defaults to wall clock.
 */
export function buildCatalog(docs: readonly StoredDocument[], now: number = Date.now()): CatalogRecord[] {
  return docs
    .flatMap(({ manifest }): CatalogRecord[] => {
      if (isExpired(manifest, now)) return [];

      const url = selectPublicUrl(manifest);
      if (!url) return [];

      return [{
        id: manifest.id,
        url,
        title: manifest.title,
        createdAt: manifest.createdAt,
        ...manifest.catalog,
      }];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
