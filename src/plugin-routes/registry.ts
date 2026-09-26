// ── PX-5 P1: RouteRegistry ──
//
// In-memory map keyed by `<pluginId>:<routeId>` so the same route id
// can coexist across plugins (tie-break is precedence + alphabetical).
// Holds compiled routes; match() is the hot path — tokenizes input
// once per call and scans route keywords O(tokens × routes).
//
// Compilation:
//   contribute() normalizes aliases + precedence + caseInsensitive
//   and memoizes a `keywords` array so match() does not rebuild per
//   invocation.
//
// Persistence:
//   persist() writes the snapshot to .elanous/routes.json via atomic
//   rename (tmp file → rename). This cache is advisory — the registry
//   always lives in-process, but other tools (LLM tool `RouteList`
//   off-session) can read the file.

import { mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  ROUTE_DEFAULTS,
  type CompiledRoute,
  type RouteContribution,
  type RouteTargetKind,
  type RoutesCompiledFile,
} from './types.js';

export interface RouteRegistryOpts {
  /** Root under which .elanous/routes.json is written. Defaults to cwd. */
  compiledRoot?: string;
  /** When true, emit stderr warnings on conflicts. Default true. */
  warnOnConflict?: boolean;
}

export class RouteRegistry {
  private routes = new Map<string, CompiledRoute>();
  private totalKeywords = 0;

  constructor(private readonly opts: RouteRegistryOpts = {}) {}

  register(pluginId: string, def: RouteContribution, isBuiltin = false): () => void {
    const key = `${pluginId}:${def.id}`;
    if (this.routes.has(key)) {
      throw new Error(`route '${key}' already registered`);
    }
    const compiled = this.compile(pluginId, def, isBuiltin);
    this.routes.set(key, compiled);
    this.totalKeywords += compiled.keywords.length;
    if (this.totalKeywords > ROUTE_DEFAULTS.maxKeywordsPerRegistry) {
      this.warn(`route registry exceeded ${ROUTE_DEFAULTS.maxKeywordsPerRegistry} total keywords; consider pruning aliases`);
    }
    return () => this.dispose(key);
  }

  dispose(keyOrPluginId: string, maybeRouteId?: string): void {
    const key = maybeRouteId ? `${keyOrPluginId}:${maybeRouteId}` : keyOrPluginId;
    const entry = this.routes.get(key);
    if (entry) {
      this.totalKeywords -= entry.keywords.length;
      this.routes.delete(key);
    }
  }

  list(filter?: { kind?: RouteTargetKind }): CompiledRoute[] {
    const all = [...this.routes.values()];
    if (!filter?.kind) return all.slice();
    return all.filter(r => r.target.kind === filter.kind);
  }

  /** Look up a single route by id. Preference order:
   *   1. `<pluginId>:<routeId>` exact match
   *   2. primary-id match, sorted by precedence (first wins) */
  get(idOrFullKey: string): CompiledRoute | null {
    const direct = this.routes.get(idOrFullKey);
    if (direct) return direct;
    for (const r of this.sortedByPrecedence()) {
      if (r.id === idOrFullKey) return r;
    }
    return null;
  }

  /** Scan text for keyword matches. Returns up to `limit` routes,
   *  sorted by precedence (ascending) then alphabetical `<plugin>:<id>`.
   *  Each route appears at most once even if multiple keywords match. */
  match(text: string, opts?: { limit?: number }): CompiledRoute[] {
    const limit = opts?.limit ?? ROUTE_DEFAULTS.bannerMaxSuggestions;
    const tokens = tokenize(text);
    if (tokens.length === 0) return [];
    const hits = new Set<CompiledRoute>();
    const lowerTokens = tokens.map(t => t.toLowerCase());
    for (const route of this.routes.values()) {
      const haystack = route.caseInsensitive ? lowerTokens : tokens;
      for (const token of haystack) {
        if (route.keywords.includes(token)) { hits.add(route); break; }
      }
    }
    return [...hits]
      .sort((a, b) =>
        a.precedence - b.precedence
          || `${a.pluginId}:${a.id}`.localeCompare(`${b.pluginId}:${b.id}`),
      )
      .slice(0, limit);
  }

  /** Resolve `$name` explicit invocation to a route. Accepts bare id
   *  or `pluginId:routeId`. Return null when no match; caller keeps
   *  the `$name` token in the user message verbatim. */
  resolveExplicit(firstTokenRouteId: string): CompiledRoute | null {
    return this.get(firstTokenRouteId.toLowerCase());
  }

  snapshot(): RoutesCompiledFile {
    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      routes: [...this.sortedByPrecedence()],
    };
  }

  async persist(): Promise<string | null> {
    const root = this.opts.compiledRoot ?? process.cwd();
    const outPath = join(root, '.elanous', 'routes.json');
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      const tmpPath = `${outPath}.tmp.${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(this.snapshot(), null, 2), 'utf-8');
      renameSync(tmpPath, outPath);
      return outPath;
    } catch (err) {
      this.warn(`route persist failed: ${(err as Error).message}`);
      return null;
    }
  }

  get size(): number { return this.routes.size; }

  clear(): void {
    this.routes.clear();
    this.totalKeywords = 0;
  }

  private compile(
    pluginId: string,
    def: RouteContribution,
    isBuiltin: boolean,
  ): CompiledRoute {
    const caseInsensitive = def.caseInsensitive ?? ROUTE_DEFAULTS.caseInsensitive;
    let precedence = def.precedence ?? ROUTE_DEFAULTS.precedence;
    if (!isBuiltin && precedence <= ROUTE_DEFAULTS.reservedPrecedenceMax) {
      this.warn(
        `route '${pluginId}:${def.id}' precedence ${precedence} is in reserved range (0-${ROUTE_DEFAULTS.reservedPrecedenceMax}); clamped to 10`,
      );
      precedence = ROUTE_DEFAULTS.reservedPrecedenceMax + 1;
    }
    const aliases = (def.aliases ?? []).slice(0, ROUTE_DEFAULTS.maxAliasesPerRoute);
    const primary = caseInsensitive ? def.id.toLowerCase() : def.id;
    const aliasList = aliases.map(a => caseInsensitive ? a.toLowerCase() : a);
    const keywords = [...new Set([primary, ...aliasList])];
    return {
      ...def,
      pluginId,
      compiledAt: Date.now(),
      precedence,
      caseInsensitive,
      keywords,
    };
  }

  private sortedByPrecedence(): Iterable<CompiledRoute> {
    return [...this.routes.values()].sort((a, b) =>
      a.precedence - b.precedence
        || `${a.pluginId}:${a.id}`.localeCompare(`${b.pluginId}:${b.id}`),
    );
  }

  private warn(msg: string): void {
    if (this.opts.warnOnConflict === false) return;
    console.warn(`[plugin-routes] ${msg}`);
  }
}

// ── Helpers also consumed by the keyword detector (P3) ─────────────────

// `$` is a separator too so `$explore` tokenises as ['explore'] —
// this lets a keyword scan treat explicit invocations the same as
// bare keywords, so "$explore scan" suggests the explore route even
// when the caller used the explicit form.
const TOKEN_SPLIT_RE = /[\s,.;:!?()[\]{}<>"'`$]+/;

export function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT_RE).filter(t => t.length > 0);
}

/** Process-wide singleton. Plugin-host registers routes here at
 *  activate; LLM tools + Turn hook consult via globalRouteRegistry. */
export const globalRouteRegistry = new RouteRegistry();
