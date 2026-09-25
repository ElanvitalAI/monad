// ── VW-term-infra Bundle B-2 · P6-1 — Artifact path resolver ──
//
// Maps `(kind, origin, ext?)` to `<baseDir>/<kind>/<YYYYMMDD-HHmmss>-
// <origin>.<ext>`. Separates:
//   * base directory (default `~/.monad/artifacts/` · test override)
//   * kind subdir (new subdir per ArtifactKind · keeps directory tidy)
//   * timestamp prefix (sortable · second-resolution for no collision
//     in 99% of real flows)
//   * sanitized origin (alphanumeric + `-` `.` `_` only)
//   * extension (per-kind default · overridable)

import { monadStateRoot } from '../autopilot/state-paths.js';
import path from 'node:path';
import type { ArtifactKind } from './types.js';

/** Default extension per kind. Capture can override (png / svg / txt
 *  / ansi / cast) via `extOverride`. */
export const DEFAULT_EXTENSIONS: Readonly<Record<ArtifactKind, string>> = Object.freeze({
  timeline:   'cast',
  layout:     'layout.json',
  capture:    'png',
  block:      'md',
  attachment: 'bin',
});

/** Base directory — `~/.monad/artifacts/`. Tests inject `mkdtemp`. */
export function defaultArtifactBaseDir(): string {
  return path.join(monadStateRoot(), 'artifacts');
}

/** Sortable timestamp `YYYYMMDD-HHmmss` from a ms-since-epoch value.
 *  UTC so cross-machine ordering stays stable. */
export function timestampSlug(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/** Whittle `origin` to filename-safe chars. Keeps `-`, `.`, `_`;
 *  collapses everything else to `-`. Empty → `unknown`. */
export function sanitizeOrigin(raw: string): string {
  const cleaned = raw.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

export interface ResolveArtifactPathOpts {
  readonly kind: ArtifactKind;
  readonly origin: string;
  readonly createdAt: number;
  readonly baseDir?: string;
  readonly extOverride?: string;
}

/** Full absolute file path for an artifact. Does NOT create
 *  directories — callers use `ensureDirForArtifact` before writing. */
export function resolveArtifactPath(opts: ResolveArtifactPathOpts): string {
  const base = opts.baseDir ?? defaultArtifactBaseDir();
  const ext = opts.extOverride ?? DEFAULT_EXTENSIONS[opts.kind];
  const stamp = timestampSlug(opts.createdAt);
  const origin = sanitizeOrigin(opts.origin);
  return path.join(base, opts.kind, `${stamp}-${origin}.${ext}`);
}

/** Meta sidecar path for a given artifact body path. */
export function metaPathFor(artifactPath: string): string {
  return `${artifactPath}.meta.json`;
}

/** Per-kind directory — `list()` reads from here. */
export function directoryFor(kind: ArtifactKind, baseDir?: string): string {
  return path.join(baseDir ?? defaultArtifactBaseDir(), kind);
}
