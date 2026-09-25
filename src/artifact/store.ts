// ── VW-term-infra Bundle B-2 · P6-1 — ArtifactStore singleton ──
//
// Unified put/get/list/subscribe for artifact output kinds
// (timeline / layout / capture / block / attachment). Backed by the
// real filesystem under `~/.monad/artifacts/<kind>/` with a JSON meta
// sidecar per body.
//
// Key properties:
//   - fs injection via `StoreDeps.fs` so tests never touch real disk
//   - in-memory index caches `list()` results · invalidated on put /
//     remove · directory scan is the fallback + source of truth
//   - subscribe receives put / remove events so future artifact-
//     browser widget can render live
//   - caller never forges `kind` / `createdAt` on put — store fills
//
// Bundle B-2 scope: foundation API. Migration of existing paths
// (timelines / layouts / blocks / captures) → Bundle B-3 (P6-2).

import * as nodeFs from 'node:fs';
import path from 'node:path';

import {
  defaultArtifactBaseDir,
  directoryFor,
  metaPathFor,
  resolveArtifactPath,
} from './paths.js';
import { decodeMeta, encodeMeta, ArtifactMetaParseError } from './meta.js';
import {
  mergeLegacyListings,
  type LegacyArtifactProvider,
} from './legacy-provider.js';
import type {
  Artifact,
  ArtifactEvent,
  ArtifactHandle,
  ArtifactKind,
  ArtifactListing,
  ArtifactMeta,
  ArtifactPutMeta,
} from './types.js';
import { ARTIFACT_KINDS } from './types.js';

// ── Fs injection ────────────────────────────────────────────────

export interface ArtifactFs {
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  writeFileSync(p: string, body: string | Buffer): void;
  readFileSync(p: string, encoding: 'utf8'): string;
  readFileSyncBuffer(p: string): Buffer;
  existsSync(p: string): boolean;
  readdirSync(p: string): readonly string[];
  statSync?(p: string): { size: number };
}

function realFs(): ArtifactFs {
  return {
    mkdirSync: (p, opts) => nodeFs.mkdirSync(p, opts),
    writeFileSync: (p, body) => nodeFs.writeFileSync(p, body),
    readFileSync: (p, enc) => nodeFs.readFileSync(p, enc),
    readFileSyncBuffer: (p) => nodeFs.readFileSync(p),
    existsSync: (p) => nodeFs.existsSync(p),
    readdirSync: (p) => nodeFs.readdirSync(p),
    statSync: (p) => nodeFs.statSync(p),
  };
}

// ── Store interface ─────────────────────────────────────────────

export interface ArtifactStoreDeps {
  readonly baseDir?: string;
  readonly fs?: ArtifactFs;
  readonly now?: () => number;
  /** Bundle B-4 · P6-3 — legacy directory scanners. Each provider
   *  surfaces pre-migration artifacts (e.g. `~/.monad/timelines/rec-
   *  *.cast` from Bundle 8T pre-migration) via `list()` without ever
   *  writing into their directory. Merged with main-store listings ·
   *  main-store wins on path collision. */
  readonly legacyProviders?: readonly LegacyArtifactProvider[];
}

export interface PutOpts {
  readonly extOverride?: string;
}

export interface ArtifactStore {
  put(
    kind: ArtifactKind,
    body: string | Buffer,
    meta: ArtifactPutMeta,
    opts?: PutOpts,
  ): ArtifactHandle;
  get(artifactPath: string): Artifact;
  list(kind?: ArtifactKind): readonly ArtifactListing[];
  subscribe(cb: (event: ArtifactEvent) => void): () => void;
  _resetForTest(): void;
}

// ── Factory ─────────────────────────────────────────────────────

export function createArtifactStore(deps: ArtifactStoreDeps = {}): ArtifactStore {
  const baseDir = deps.baseDir ?? defaultArtifactBaseDir();
  const fs = deps.fs ?? realFs();
  const now = deps.now ?? (() => Date.now());
  const subs = new Set<(ev: ArtifactEvent) => void>();
  const legacyProviders = deps.legacyProviders ?? [];
  /** path → listing cache. Wiped on put / remove. Populated lazily
   *  in list(). NOTE: cache stores main-store-only entries; legacy
   *  providers are rescanned on every list() call (small directories
   *  + flush rate is low so this stays cheap). */
  const indexByKind = new Map<ArtifactKind, ArtifactListing[]>();

  function invalidate(kind: ArtifactKind): void {
    indexByKind.delete(kind);
  }

  function emit(event: ArtifactEvent): void {
    for (const cb of subs) {
      try { cb(event); } catch { /* subscriber isolation */ }
    }
  }

  function scanKind(kind: ArtifactKind): ArtifactListing[] {
    const dir = directoryFor(kind, baseDir);
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir);
    const listings: ArtifactListing[] = [];
    for (const name of entries) {
      if (name.endsWith('.meta.json')) continue;
      const bodyPath = path.join(dir, name);
      const metaPath = metaPathFor(bodyPath);
      if (!fs.existsSync(metaPath)) continue;
      try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const meta = decodeMeta(raw);
        listings.push({ path: bodyPath, meta });
      } catch (err) {
        if (err instanceof ArtifactMetaParseError) continue;
        throw err;
      }
    }
    listings.sort((a, b) => a.meta.createdAt - b.meta.createdAt);
    return listings;
  }

  const store: ArtifactStore = {
    put(kind, body, meta, opts) {
      const createdAt = now();
      const sizeBytes = typeof body === 'string'
        ? Buffer.byteLength(body, 'utf8')
        : body.byteLength;
      const fullMeta: ArtifactMeta = {
        kind,
        origin: meta.origin,
        createdAt,
        sizeBytes,
        ...(meta.description !== undefined ? { description: meta.description } : {}),
        ...(meta.tags !== undefined ? { tags: [...meta.tags] } : {}),
        ...(meta.producer !== undefined ? { producer: meta.producer } : {}),
        ...(meta.extra !== undefined ? { extra: { ...meta.extra } } : {}),
      };
      const bodyPath = resolveArtifactPath({
        kind,
        origin: meta.origin,
        createdAt,
        baseDir,
        ...(opts?.extOverride ? { extOverride: opts.extOverride } : {}),
      });
      fs.mkdirSync(path.dirname(bodyPath), { recursive: true });
      fs.writeFileSync(bodyPath, body);
      const metaPath = metaPathFor(bodyPath);
      fs.writeFileSync(metaPath, encodeMeta(fullMeta));
      invalidate(kind);
      const handle: ArtifactHandle = { path: bodyPath, metaPath, meta: fullMeta };
      emit({ kind: 'put', handle });
      return handle;
    },

    get(artifactPath) {
      const metaPath = metaPathFor(artifactPath);
      if (!fs.existsSync(artifactPath) || !fs.existsSync(metaPath)) {
        throw new Error(`artifact not found: ${artifactPath}`);
      }
      const metaRaw = fs.readFileSync(metaPath, 'utf8');
      const meta = decodeMeta(metaRaw);
      // Binary vs text: read utf8 for text-kinds · Buffer otherwise.
      const isText = meta.kind === 'timeline'
        || meta.kind === 'layout'
        || meta.kind === 'block';
      const body = isText
        ? fs.readFileSync(artifactPath, 'utf8')
        : fs.readFileSyncBuffer(artifactPath);
      return { path: artifactPath, metaPath, meta, body };
    },

    list(kind) {
      const mainForKind = (k: ArtifactKind): ArtifactListing[] => {
        const cached = indexByKind.get(k);
        if (cached) return cached;
        const fresh = scanKind(k);
        indexByKind.set(k, fresh);
        return fresh;
      };
      if (kind) {
        const main = mainForKind(kind);
        return legacyProviders.length > 0
          ? mergeLegacyListings(main, legacyProviders, kind)
          : main;
      }
      const all: ArtifactListing[] = [];
      for (const k of ARTIFACT_KINDS) all.push(...mainForKind(k));
      return legacyProviders.length > 0
        ? mergeLegacyListings(all, legacyProviders)
        : (all.sort((a, b) => a.meta.createdAt - b.meta.createdAt), all);
    },

    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },

    _resetForTest() {
      indexByKind.clear();
      subs.clear();
    },
  };

  return store;
}
