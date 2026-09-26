// ── apm_external-markdown-publishing · Arc 1 · Task 3 ──
//
// Atomic, immutable artifact store for published Markdown documents.
//
// Design (RFC + prior-phase decisions):
//   - One document directory per publish ID holds every artifact:
//       내부 문서 `source`            (PRIVATE — never web-served)
//       docs/<id>/manifest.json        (PRIVATE — never web-served)
//       docs/<id>/targets/<t>/index.html  (PUBLIC web boundary)
//   - Commit is atomic: every file is written into a *sibling* tmp
//     directory (tmp/<id>.<rand>), flushed/closed in RFC order, then
//     the whole directory is renamed into place. A partial or failed
//     write never exposes a completed artifact.
//   - The same publish ID is never overwritten: an existing committed
//     directory yields a `collision` error and is left untouched.
//   - Startup recovery clears tmp remnants and quarantines committed
//     directories that lack a valid manifest.
//   - Expiry is manifest-driven (createdAt + 30d, inclusive boundary)
//     via an injectable clock; deletion is idempotent.
//
// The store only reuses the ArtifactFs filesystem boundary style from
// src/artifact/store.ts (fs injection); it does NOT reuse the generic
// ArtifactStore because that lacks atomic directory commit / expiry.

import * as nodeFs from 'node:fs';
import path from 'node:path';

import type {
  PublishError,
  PublishId,
  PublishManifest,
  PublishTarget,
} from './types.js';

/** 게시물 기본 라이프사이클(대표 2026-07-23: 공개는 길게·기본 1년). env ELANOUS_PUBLISH_TTL_DAYS 로 override.
 *  만료는 삭제가 아니라 콜드 백업 대상 신호(GC 가 S3 콜드 이관·콜드리드 가능·영구옵션은 별도). */
const PUBLISH_TTL_DAYS_DEFAULT = 365;
function resolvePublishTtlMs(): number {
  const d = Number(process.env.ELANOUS_PUBLISH_TTL_DAYS);
  const days = Number.isFinite(d) && d > 0 ? d : PUBLISH_TTL_DAYS_DEFAULT;
  return days * 24 * 60 * 60 * 1000;
}
export const PUBLISH_TTL_MS = resolvePublishTtlMs();

/** Publish ID format: unpadded base64url, exactly 22 chars (128-bit). */
const PUBLISH_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Relative artifact paths allowed inside a document directory. */
const PRIVATE_RELATIVE_PATHS = ['source.md', 'manifest.json'] as const;
const PUBLIC_RELATIVE_PATHS: Record<PublishTarget, string> = {
  funnel: 'targets/funnel/index.html',
  cloudfront: 'targets/cloudfront/index.html',
};

// ── Filesystem injection boundary ───────────────────────────────

export interface PublishArtifactFs {
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  writeFileSync(p: string, body: string | Buffer): void;
  readFileSync(p: string, encoding: 'utf8'): string;
  existsSync(p: string): boolean;
  readdirSync(p: string): readonly string[];
  renameSync(from: string, to: string): void;
  rmSync(p: string, opts: { recursive: boolean; force: boolean }): void;
}

function realFs(): PublishArtifactFs {
  return {
    mkdirSync: (p, opts) => nodeFs.mkdirSync(p, opts),
    writeFileSync: (p, body) => nodeFs.writeFileSync(p, body),
    readFileSync: (p, enc) => nodeFs.readFileSync(p, enc),
    existsSync: (p) => nodeFs.existsSync(p),
    readdirSync: (p) => nodeFs.readdirSync(p),
    renameSync: (from, to) => nodeFs.renameSync(from, to),
    rmSync: (p, opts) => nodeFs.rmSync(p, opts),
  };
}

// ── Error helper ────────────────────────────────────────────────

/** Structured, discriminated store failure (see PublishError in types). */
export class PublishStoreError extends Error {
  readonly detail: PublishError;
  constructor(detail: PublishError) {
    super(detail.message);
    this.name = 'PublishStoreError';
    this.detail = detail;
  }
}

// ── Validation ──────────────────────────────────────────────────

/** True iff `id` is a well-formed publish ID (128-bit base64url, 22 chars). */
export function isValidPublishId(id: string): id is PublishId {
  return PUBLISH_ID_PATTERN.test(id);
}

function assertPublishId(id: string): asserts id is PublishId {
  if (!isValidPublishId(id)) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `invalid publish id: ${JSON.stringify(id)}`,
    });
  }
}

/**
 * Reject absolute paths, empties, NUL bytes, `.`/`..` traversal, platform
 * separators and any path that normalizes outside the document directory.
 * Only the known private/public relative artifact paths are accepted.
 */
export function validateRelativeArtifactPath(rel: string): void {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: 'empty artifact path',
    });
  }
  if (rel.includes('\0')) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: 'artifact path contains NUL',
    });
  }
  if (path.isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `absolute artifact path rejected: ${rel}`,
    });
  }
  if (rel.includes('\\')) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `backslash separator rejected: ${rel}`,
    });
  }
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `path traversal rejected: ${rel}`,
    });
  }
  const normalized = path.posix.normalize(rel);
  if (normalized !== rel || normalized.startsWith('..')) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `non-canonical artifact path rejected: ${rel}`,
    });
  }
  const allowed = new Set<string>([
    ...PRIVATE_RELATIVE_PATHS,
    ...Object.values(PUBLIC_RELATIVE_PATHS),
  ]);
  if (!allowed.has(rel)) {
    throw new PublishStoreError({
      code: 'invalid_input',
      field: 'target',
      message: `artifact path not in allow-list: ${rel}`,
    });
  }
}

// ── Store ───────────────────────────────────────────────────────

export interface PublishArtifactStoreDeps {
  /** Root directory that holds `docs/` and `tmp/` subtrees. */
  readonly root: string;
  readonly fs?: PublishArtifactFs;
  readonly now?: () => number;
}

/** Payload committed atomically for a single published document. */
export interface CommitInput {
  readonly manifest: PublishManifest;
  readonly sourceMarkdown: string;
  /** Rendered HTML per target; keys must appear in `manifest.targets`. */
  readonly targets: Partial<Record<PublishTarget, string>>;
}

/** A recovered, committed document (manifest only; bodies read on demand). */
export interface StoredDocument {
  readonly id: PublishId;
  readonly manifest: PublishManifest;
}

export interface PublishArtifactStore {
  /** Atomically commit a new document. Throws `collision` if id exists. */
  commit(input: CommitInput): StoredDocument;
  /** Read a committed manifest. Throws `missing` if absent. */
  readManifest(id: string): PublishManifest;
  /** Read a public target artifact. Throws `missing`/`expired`. */
  readPublicArtifact(id: string, target: PublishTarget): string;
  /** True iff the document is at/after its expiry instant. */
  isExpired(id: string): boolean;
  /** Idempotent deletion. Never throws for an absent id. */
  delete(id: string): void;
  /** List all valid committed documents. */
  list(): readonly StoredDocument[];
  /** Startup recovery: clear tmp remnants, quarantine invalid docs. */
  recover(): void;
}

export function createPublishArtifactStore(
  deps: PublishArtifactStoreDeps,
): PublishArtifactStore {
  const fs = deps.fs ?? realFs();
  const now = deps.now ?? (() => Date.now());
  const root = deps.root;
  const docsDir = path.join(root, 'docs');
  const tmpDir = path.join(root, 'tmp');

  function docDir(id: PublishId): string {
    return path.join(docsDir, id);
  }

  function loadManifest(id: PublishId): PublishManifest | null {
    const manifestPath = path.join(docDir(id), 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as PublishManifest;
      if (parsed.version !== 1 || parsed.id !== id) return null;
      if (typeof parsed.expiresAt !== 'string' || typeof parsed.createdAt !== 'string') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function expired(manifest: PublishManifest): boolean {
    const expiresAt = Date.parse(manifest.expiresAt);
    if (Number.isNaN(expiresAt)) return true;
    // Inclusive boundary: expired at or after `expiresAt`.
    return now() >= expiresAt;
  }

  const store: PublishArtifactStore = {
    commit(input) {
      const id = input.manifest.id;
      assertPublishId(id);

      const finalDir = docDir(id);
      // No-overwrite guard: a committed directory is never replaced.
      if (fs.existsSync(finalDir)) {
        throw new PublishStoreError({
          code: 'collision',
          id,
          message: `publish id already committed: ${id}`,
        });
      }

      // Sibling tmp directory on the same filesystem for a cheap rename.
      const stage = path.join(tmpDir, `${id}.${randomSuffix()}`);
      try {
        fs.mkdirSync(stage, { recursive: true });

        // 1) source.md (private)
        validateRelativeArtifactPath('source.md');
        writeArtifact(fs, stage, 'source.md', input.sourceMarkdown);

        // 2) target artifacts (public web boundary)
        for (const target of Object.keys(input.targets) as PublishTarget[]) {
          const html = input.targets[target];
          if (html === undefined) continue;
          if (!input.manifest.targets[target]) {
            throw new PublishStoreError({
              code: 'partial_write',
              id,
              successfulTargets: [],
              failedTargets: [
                { target, message: `target ${target} missing from manifest` },
              ],
              message: `target body without manifest entry: ${target}`,
            });
          }
          const rel = PUBLIC_RELATIVE_PATHS[target];
          validateRelativeArtifactPath(rel);
          writeArtifact(fs, stage, rel, html);
        }

        // 3) manifest.json LAST — its presence marks completion (private).
        validateRelativeArtifactPath('manifest.json');
        writeArtifact(
          fs,
          stage,
          'manifest.json',
          JSON.stringify(input.manifest, null, 2),
        );

        // 4) Atomic publish: rename staged dir into place. Re-check to
        //    avoid overwriting a concurrently-created final directory.
        if (fs.existsSync(finalDir)) {
          throw new PublishStoreError({
            code: 'collision',
            id,
            message: `publish id already committed: ${id}`,
          });
        }
        fs.mkdirSync(docsDir, { recursive: true });
        fs.renameSync(stage, finalDir);
      } catch (err) {
        // Best-effort cleanup of the uncommitted staging directory so no
        // partial artifact is ever exposed.
        try {
          fs.rmSync(stage, { recursive: true, force: true });
        } catch {
          /* leftover cleaned by recover() on next startup */
        }
        throw err;
      }

      return { id, manifest: input.manifest };
    },

    readManifest(id) {
      assertPublishId(id);
      const manifest = loadManifest(id);
      if (!manifest) {
        throw new PublishStoreError({
          code: 'missing',
          id,
          message: `document not found: ${id}`,
        });
      }
      return manifest;
    },

    readPublicArtifact(id, target) {
      assertPublishId(id);
      const manifest = loadManifest(id);
      if (!manifest) {
        throw new PublishStoreError({
          code: 'missing',
          id,
          message: `document not found: ${id}`,
        });
      }
      if (expired(manifest)) {
        throw new PublishStoreError({
          code: 'expired',
          id,
          expiresAt: manifest.expiresAt,
          message: `document expired: ${id}`,
        });
      }
      const rel = PUBLIC_RELATIVE_PATHS[target];
      const artifactPath = path.join(docDir(id), rel);
      if (!manifest.targets[target] || !fs.existsSync(artifactPath)) {
        throw new PublishStoreError({
          code: 'missing',
          id,
          message: `target artifact not found: ${id}/${target}`,
        });
      }
      return fs.readFileSync(artifactPath, 'utf8');
    },

    isExpired(id) {
      assertPublishId(id);
      const manifest = loadManifest(id);
      if (!manifest) return true;
      return expired(manifest);
    },

    delete(id) {
      assertPublishId(id);
      const dir = docDir(id);
      if (!fs.existsSync(dir)) return; // idempotent
      fs.rmSync(dir, { recursive: true, force: true });
    },

    list() {
      if (!fs.existsSync(docsDir)) return [];
      const out: StoredDocument[] = [];
      for (const name of fs.readdirSync(docsDir)) {
        if (!isValidPublishId(name)) continue;
        const manifest = loadManifest(name);
        if (!manifest) continue;
        out.push({ id: name, manifest });
      }
      return out;
    },

    recover() {
      // 1) Wipe tmp remnants — never promoted, never trustworthy.
      if (fs.existsSync(tmpDir)) {
        for (const name of fs.readdirSync(tmpDir)) {
          try {
            fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }
      }
      // 2) Quarantine committed directories missing a valid manifest.
      if (fs.existsSync(docsDir)) {
        for (const name of fs.readdirSync(docsDir)) {
          const dir = path.join(docsDir, name);
          if (!isValidPublishId(name) || !loadManifest(name)) {
            try {
              fs.rmSync(dir, { recursive: true, force: true });
            } catch {
              /* best-effort */
            }
          }
        }
      }
    },
  };

  return store;
}

// ── internals ───────────────────────────────────────────────────

function randomSuffix(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
}

function writeArtifact(
  fs: PublishArtifactFs,
  stage: string,
  rel: string,
  body: string,
): void {
  const dest = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
}
