// ── PX-5 P3: keyword detector + $name parser ──
//
// Two pure functions on top of the registry (P1):
//   1. detectKeywords(text) — scan user text for route keyword matches,
//      sorted by precedence; bounded by limit (default 5).
//   2. parseExplicitInvocation(text) — recognise "$name ..." first-
//      token pattern and split into {routeId, argsText}.
//
// Both are stateless — the registry is the sole source of truth. The
// Turn hook (P4) calls these once per turn and composes the banner.

import {
  globalRouteRegistry,
  tokenize,
  type RouteRegistry,
} from './registry.js';
import { ROUTE_DEFAULTS, type CompiledRoute } from './types.js';

// Regex: `$name` (alphanumeric start + -, _ allowed; up to 64 chars;
// followed by whitespace or end-of-string). Case-insensitive capture
// so the route id lookup can lowercase uniformly. Multi-line flag
// safe because only the first line ever feeds $name detection — but
// we still gate on `trim()` first to handle leading whitespace.
const EXPLICIT_INVOCATION_RE = /^\$([a-z0-9][a-z0-9_-]{0,63})(?:\s+(.*))?$/is;

export interface ExplicitInvocation {
  routeId: string;        // normalised to lowercase
  argsText: string;       // '' when no args follow
  fullToken: string;      // '$name' as it appeared in the source
}

export function parseExplicitInvocation(text: string): ExplicitInvocation | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('$')) return null;
  // $$ (double-$, markdown math, bash `$$`) — treat as ordinary text.
  if (trimmed.startsWith('$$')) return null;
  const m = EXPLICIT_INVOCATION_RE.exec(trimmed);
  if (!m) return null;
  return {
    routeId: m[1]!.toLowerCase(),
    argsText: (m[2] ?? '').trim(),
    fullToken: `$${m[1]}`,
  };
}

export interface DetectOpts {
  limit?: number;
  registry?: RouteRegistry;
}

export function detectKeywords(text: string, opts: DetectOpts = {}): CompiledRoute[] {
  const reg = opts.registry ?? globalRouteRegistry;
  return reg.match(text, { limit: opts.limit ?? ROUTE_DEFAULTS.bannerMaxSuggestions });
}

// Re-export tokenize so tests that consume the detector can verify
// token boundaries without a separate import.
export { tokenize };
