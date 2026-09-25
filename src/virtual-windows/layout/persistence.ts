// ── VW-term-infra Phase 3a — LayoutSpec persistence ──
//
// Save / load / list LayoutSpec files under ~/.monad/layouts/. Each file
// is one JSON-serialized LayoutSpec. Filenames derive from the
// caller-provided slug (windowId-label fallback); the slug is sanitized
// so a hostile spec can never write outside the layouts directory
// (../foo → foo, slashes → '-', ...).
//
// Design:
//   - Storage root is `~/.monad/layouts/` by default but overridable via
//     `LayoutPersistenceOpts.dir` so tests can sandbox into tmp.
//   - Unknown files (wrong extension, unreadable JSON) are skipped with
//     a captured `skipped` entry in list() output rather than failing
//     the whole enumeration — UI layers can surface "broken preset"
//     toasts without the session falling over.
//   - Writes are atomic via `tmp-file + rename` so crash during save
//     leaves the prior version intact.
//
// See: 내부 문서 `PLAN-session-vw-term-infra-p3-p5` §3.5

import { constants, promises as fsp } from 'node:fs';
import { monadStateRoot } from '../../autopilot/state-paths.js';
import { join, resolve } from 'node:path';

import { debug } from '../../debug/log.js';
import type { ArtifactStore } from '../../artifact/index.js';
import { fromJson, toJson } from './serializer.js';
import { LayoutSpecValidationError, type LayoutSpec } from './types.js';

export interface LayoutPersistenceOpts {
  /** Absolute directory. Defaults to ~/.monad/layouts/. Tests override. */
  readonly dir?: string;
}

export interface SavedLayoutListing {
  readonly slug: string;
  readonly path: string;
  readonly spec: LayoutSpec;
}

export interface SkippedLayoutListing {
  readonly slug: string;
  readonly path: string;
  readonly reason: string;
}

export interface LayoutListResult {
  readonly loaded: readonly SavedLayoutListing[];
  readonly skipped: readonly SkippedLayoutListing[];
}

const LAYOUT_EXT = '.layout.json';

/** The effective layouts directory. Exported so callers that want to
 *  open the folder in a file browser can stat/mkdirp. */
export function layoutsDir(opts?: LayoutPersistenceOpts): string {
  return opts?.dir ?? join(monadStateRoot(), 'layouts');
}

/** Slugify an arbitrary label into a filename-safe token.
 *  Deterministic — same input always yields the same slug so
 *  overwriting a named preset works. */
export function slugify(raw: string): string {
  if (!raw) return 'unnamed';
  const ascii = raw
    .trim()
    .toLowerCase()
    .replace(/[\\/:]+/g, '-')     // path separators + colon → dash
    .replace(/\s+/g, '-')         // whitespace → dash
    .replace(/[^a-z0-9_\-.]+/g, '') // drop anything else
    .replace(/-{2,}/g, '-');      // collapse consecutive dashes
  // Strip leading dots / dashes so we don't produce hidden files or
  // accidental relative paths.
  const trimmed = ascii.replace(/^[.\-]+/, '').replace(/[.\-]+$/, '');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'unnamed';
}

/** Compute a save slug for a spec. Prefers label, falls back to windowId. */
export function specSlug(spec: LayoutSpec): string {
  return slugify(spec.label && spec.label.length > 0 ? spec.label : spec.windowId);
}

export interface SaveLayoutSpecOpts extends LayoutPersistenceOpts {
  readonly slug?: string;
  /** Bundle B-5 (P6-4) — unified artifact persistence. When provided,
   *  the layout body is stored via `store.put('layout', ...)` under
   *  `~/.monad/artifacts/layout/` and the returned path points there
   *  instead of the legacy `~/.monad/layouts/` directory. Legacy path
   *  is still the fallback when `artifactStore` is absent (hermetic
   *  tests + any caller without store DI). */
  readonly artifactStore?: ArtifactStore;
}

export async function saveLayoutSpec(
  spec: LayoutSpec,
  opts?: SaveLayoutSpecOpts,
): Promise<string> {
  const slug = slugify(opts?.slug ?? specSlug(spec));
  const body = toJson(spec, true);

  // Bundle B-5 · unified artifact store path (preferred).
  if (opts?.artifactStore) {
    const handle = opts.artifactStore.put('layout', body, {
      origin: slug,
      producer: 'vwt-3a',
      description: spec.label ?? `Layout for window ${spec.windowId}`,
      tags: ['layout', `window-${spec.windowId}`],
    });
    if (debug.enabled) {
      debug.log('layout.persistence.save.artifact', slug, {
        path: handle.path,
        bytes: body.length,
      });
    }
    return handle.path;
  }

  // Legacy fallback — `~/.monad/layouts/<slug>.layout.json` atomic write.
  const dir = layoutsDir(opts);
  await fsp.mkdir(dir, { recursive: true });
  const finalPath = resolve(dir, `${slug}${LAYOUT_EXT}`);
  const tmpPath = `${finalPath}.tmp.${process.pid}`;
  await fsp.writeFile(tmpPath, body, 'utf8');
  await fsp.rename(tmpPath, finalPath);
  if (debug.enabled) {
    debug.log('layout.persistence.save', slug, { path: finalPath, bytes: body.length });
  }
  return finalPath;
}

export async function loadLayoutSpec(
  slug: string,
  opts?: LayoutPersistenceOpts,
): Promise<LayoutSpec> {
  const dir = layoutsDir(opts);
  const safeSlug = slugify(slug);
  const path = resolve(dir, `${safeSlug}${LAYOUT_EXT}`);
  const body = await fsp.readFile(path, 'utf8');
  return fromJson(body);
}

/** Bundle B-6 (P6-5) — direct-path loader. Accepts an absolute
 *  artifact path returned by `ListArtifacts({kind:'layout'})` and
 *  reads the spec without slug inference. Caller is responsible for
 *  path validation (e.g. via ArtifactStore.list()). */
export async function loadLayoutSpecFromPath(absPath: string): Promise<LayoutSpec> {
  const body = await fsp.readFile(absPath, 'utf8');
  return fromJson(body);
}

/** Bundle B-6 (P6-5) — slug-to-artifact resolution. Scans the store's
 *  `layout` kind for an entry whose `meta.origin === slug` · returns
 *  the newest by `createdAt` · returns `null` when no match (caller
 *  falls back to the legacy `~/.monad/layouts/<slug>.layout.json`
 *  path). Store-native resolution preferred for LLM-supplied slugs
 *  since the artifact path carries a timestamp prefix that makes
 *  direct file access ambiguous. */
export function resolveLayoutArtifactPath(
  slug: string,
  store: import('../../artifact/index.js').ArtifactStore,
): string | null {
  const safeSlug = slugify(slug);
  const listings = store.list('layout');
  const matching = listings.filter((l) => l.meta.origin === safeSlug);
  if (matching.length === 0) return null;
  // list() already sorts by createdAt ascending — pick the last entry
  // (newest) when the slug has multiple versions.
  return matching[matching.length - 1]!.path;
}

export async function listLayoutSpecs(
  opts?: LayoutPersistenceOpts,
): Promise<LayoutListResult> {
  const dir = layoutsDir(opts);
  try {
    await fsp.access(dir, constants.R_OK);
  } catch {
    return { loaded: [], skipped: [] };
  }
  const entries = await fsp.readdir(dir);
  const loaded: SavedLayoutListing[] = [];
  const skipped: SkippedLayoutListing[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(LAYOUT_EXT)) continue;
    const path = resolve(dir, entry);
    const slug = entry.slice(0, -LAYOUT_EXT.length);
    try {
      const body = await fsp.readFile(path, 'utf8');
      const spec = fromJson(body);
      loaded.push({ slug, path, spec });
    } catch (err) {
      const reason = err instanceof LayoutSpecValidationError
        ? err.message
        : `read error: ${String(err)}`;
      skipped.push({ slug, path, reason });
      if (debug.enabled) debug.log('layout.persistence.skip', slug, { reason });
    }
  }
  // Sort by createdAt desc so newest shows first — UI layers pick that
  // order for "recent layouts" lists.
  loaded.sort((a, b) => b.spec.createdAt - a.spec.createdAt);
  return { loaded, skipped };
}

export async function deleteLayoutSpec(
  slug: string,
  opts?: LayoutPersistenceOpts,
): Promise<boolean> {
  const dir = layoutsDir(opts);
  const safeSlug = slugify(slug);
  const path = resolve(dir, `${safeSlug}${LAYOUT_EXT}`);
  try {
    await fsp.unlink(path);
    if (debug.enabled) debug.log('layout.persistence.delete', safeSlug, { path });
    return true;
  } catch {
    return false;
  }
}
