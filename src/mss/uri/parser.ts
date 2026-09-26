// ── Elanous URI parser — Tier 1/2/3 → structured form ──
//
// Grammar (PLAN §7.1):
//   elanous-uri = "elanous://" host "/" elanous-id "/" entity-path ["#" fragment] ["?" query]
//   entity-path = entity-kind "/" entity-id ["/" entity-path ...]
//
// Tier 1 (short):       <kind>_<suffix>        e.g. `ses_01HYZA`
// Tier 2 (local):       <kind>/<id>[/...]      e.g. `session/01HYZ.../msg/01HZA...`
// Tier 3 (distributed): elanous://host/elanous-id/<entity-path>[?q][#f]
//
// The parser returns `null` on malformed input rather than throwing so
// callers at system boundaries can handle errors explicitly.

import { type EntityKind, isEntityKind, resolveTier1Kind } from './brand.js';

export type UriTier = 1 | 2 | 3;

export interface ParsedUriSegment {
  kind: EntityKind;
  id: string;
}

export interface ParsedElanousUri {
  tier: UriTier;
  /** Tier 3 only — host portion (`local`, hostname, tailscale name). */
  host?: string;
  /** Tier 3 only — the owning elanous's ULID. */
  elanousId?: string;
  /** For Tier 1 this is always a single segment (the suffix form carries no parent).
   *  For Tier 2/3 every `kind/id` pair becomes one segment. */
  segments: ParsedUriSegment[];
  fragment?: string;
  query?: Record<string, string>;
}

/** Shared delim constants — local to this module so every regex lives here. */
const ULID_RE = /^[0-9A-HJKMNPQRSTVWXYZ]{26}$/;
const SHORT_RE = /^([a-z][a-z0-9-]*)_([0-9A-Z]{4,12})$/;
const KIND_RE  = /^[a-z][a-z0-9-]*$/;
const ENTITY_ID_RE = /^[0-9A-HJKMNPQRSTVWXYZa-zA-Z0-9._-]+$/;

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}

function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!q) return out;
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) { out[decodeURIComponent(part)] = ''; continue; }
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function splitEntityPath(path: string): ParsedUriSegment[] | null {
  const parts = path.split('/').filter(p => p.length > 0);
  if (parts.length === 0 || parts.length % 2 !== 0) return null;
  const out: ParsedUriSegment[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const kind = parts[i]!;
    const id = parts[i + 1]!;
    if (!KIND_RE.test(kind) || !isEntityKind(kind)) return null;
    if (!ENTITY_ID_RE.test(id)) return null;
    out.push({ kind: kind as EntityKind, id });
  }
  return out;
}

/** Parse any Tier 1/2/3 form. Returns null for malformed input. */
export function parseElanousUri(uri: string): ParsedElanousUri | null {
  if (typeof uri !== 'string' || uri.length === 0) return null;

  // --- Tier 1 shortcut -------------------------------------------------
  const short = SHORT_RE.exec(uri);
  if (short) {
    const [, token, suffix] = short;
    const resolved = resolveTier1Kind(token!);
    if (!resolved) return null;
    return {
      tier: 1,
      segments: [{ kind: resolved, id: suffix! }],
    };
  }

  // --- Tier 3 ----------------------------------------------------------
  if (uri.startsWith('elanous://')) {
    // Strip scheme
    const rest0 = uri.slice('elanous://'.length);
    // Split off fragment + query
    let main = rest0;
    let fragment: string | undefined;
    let query: Record<string, string> | undefined;
    const hashIdx = main.indexOf('#');
    const qIdx = main.indexOf('?');
    // query comes before fragment syntactically in our grammar; handle both orders defensively
    if (qIdx >= 0 && (hashIdx < 0 || qIdx < hashIdx)) {
      const qPart = hashIdx >= 0 ? main.slice(qIdx + 1, hashIdx) : main.slice(qIdx + 1);
      query = parseQuery(qPart);
      main = main.slice(0, qIdx) + (hashIdx >= 0 ? main.slice(hashIdx) : '');
    }
    const hashIdx2 = main.indexOf('#');
    if (hashIdx2 >= 0) {
      fragment = main.slice(hashIdx2 + 1);
      main = main.slice(0, hashIdx2);
    }
    // In case '?' showed up after the '#' (tolerant), parse it now
    const qIdx2 = main.indexOf('?');
    if (qIdx2 >= 0 && !query) {
      query = parseQuery(main.slice(qIdx2 + 1));
      main = main.slice(0, qIdx2);
    }

    const segs = main.split('/');
    // Expect at least [host, elanousId, kind, id]
    if (segs.length < 4) return null;
    const host = segs[0]!;
    const elanousId = segs[1]!;
    if (!host || !KIND_RE.test(host) && host !== 'local' && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) return null;
    if (!isUlid(elanousId)) return null;
    const entityPath = segs.slice(2).join('/');
    const segments = splitEntityPath(entityPath);
    if (!segments) return null;
    const out: ParsedElanousUri = { tier: 3, host, elanousId, segments };
    if (fragment !== undefined) out.fragment = fragment;
    if (query !== undefined) out.query = query;
    return out;
  }

  // --- Tier 2 (local) --------------------------------------------------
  const segments = splitEntityPath(uri);
  if (segments) return { tier: 2, segments };

  return null;
}
