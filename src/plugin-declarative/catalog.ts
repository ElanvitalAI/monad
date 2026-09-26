// ── PX-7 P3: compile + persist declarative catalog ──
//
// Walks both sources (project + user) for every kind, parses each
// file via P2, and emits a single DeclarativeCatalog snapshot. The
// snapshot is also persisted to `<user>/catalog.json` via atomic
// write so external tools (editor extensions, LLM tools) can inspect
// the resolved state.
//
// Project overrides user for the same id — a project-local agent
// with id='explore' shadows the user-global one. Reserved ids are
// skipped with a warn so builtin contributions are never clobbered.

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DECLARATIVE_KINDS,
  listDeclarativeFiles,
  type DeclarativeKind,
  type DeclarativeSources,
} from './discovery.js';
import {
  parseDeclarationFile,
  type ParsedDeclaration,
} from './parser.js';

export interface DeclarativeCatalog {
  schemaVersion: 1;
  generatedAt: number;
  sources: DeclarativeSources;
  agents: ParsedDeclaration[];
  skills: ParsedDeclaration[];
  missions: ParsedDeclaration[];
  workflows: ParsedDeclaration[];
  hooks: ParsedDeclaration[];
  routes: ParsedDeclaration[];
}

export interface BuildCatalogOpts {
  onWarn?: (path: string, reason: string) => void;
}

/** Reserved ids per kind. User-declared entries that collide are
 *  skipped with a warn — we want to guarantee that builtins always
 *  resolve unambiguously (elanous policy, opposite of OMC). */
export const RESERVED_IDS: Record<DeclarativeKind, readonly string[]> = {
  agents: ['general-purpose', 'aggregator', 'data-collector',
           'explore', 'plan', 'research', 'critic', 'executor'],
  skills: [],
  missions: [],
  workflows: [],
  hooks: [],
  routes: ['explore', 'plan', 'research', 'critic', 'executor'],
};

export function buildCatalog(
  sources: DeclarativeSources,
  opts: BuildCatalogOpts = {},
): DeclarativeCatalog {
  const catalog: DeclarativeCatalog = {
    schemaVersion: 1,
    generatedAt: Date.now(),
    sources,
    agents: [],
    skills: [],
    missions: [],
    workflows: [],
    hooks: [],
    routes: [],
  };

  for (const kind of DECLARATIVE_KINDS) {
    const seenIds = new Set<string>();
    // Project FIRST so its entries claim ids and user entries later
    // collide (→ skipped as "shadowed by project").
    const projectFiles = sources.project
      ? listDeclarativeFiles(sources.project, kind).map(p => ({ p, source: 'project' as const }))
      : [];
    const userFiles = listDeclarativeFiles(sources.user, kind)
      .map(p => ({ p, source: 'user' as const }));
    for (const { p, source } of [...projectFiles, ...userFiles]) {
      const parsed = parseDeclarationFile(p, kind, source, { onWarn: opts.onWarn });
      if (!parsed) continue;
      if ((RESERVED_IDS[kind] ?? []).includes(parsed.id)) {
        opts.onWarn?.(p, `id '${parsed.id}' is reserved for builtin ${kind} — skipped`);
        continue;
      }
      if (seenIds.has(parsed.id)) {
        opts.onWarn?.(p, `id '${parsed.id}' already contributed from another source — skipped`);
        continue;
      }
      seenIds.add(parsed.id);
      catalog[kind].push(parsed);
    }
  }
  return catalog;
}

export async function persistCatalog(
  catalog: DeclarativeCatalog,
  path?: string,
): Promise<string | null> {
  const outPath = path ?? join(catalog.sources.user, 'catalog.json');
  try {
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${outPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    writeFileSync(tmp, JSON.stringify(catalog, null, 2), 'utf-8');
    renameSync(tmp, outPath);
    return outPath;
  } catch {
    return null;
  }
}

/** Convenience — rebuild + persist in one call. Used by the watcher
 *  (P4) onChange debounce. */
export async function rebuildAndPersist(
  sources: DeclarativeSources,
  opts: BuildCatalogOpts = {},
): Promise<DeclarativeCatalog> {
  const catalog = buildCatalog(sources, opts);
  await persistCatalog(catalog);
  return catalog;
}
