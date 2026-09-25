// ── PFC-S4.2: KnowledgeQuery core ──
//
// Walks the Obsidian vault (or simulated fallback), parses frontmatter,
// and returns notes matching the requested filter (tags AND + optional
// regex fulltext + optional kind). MVP has no caching; every query
// re-scans. Acceptable at vault sizes <~10k notes; tag index is a
// follow-up.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseFrontmatter, type ObsidianVault } from '../auto-research/obsidian-bridge.js';
import type { KnowledgeKind, KnowledgeNote, KnowledgeQueryInput, KnowledgeQueryResult } from './types.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const EXCERPT_HEAD_CHARS = 300;
const EXCERPT_CONTEXT_CHARS = 200;

const KIND_DIR_HINTS: Record<Exclude<KnowledgeKind, 'all'>, readonly string[]> = {
  rca: ['RCA'],
  a3: ['A3'],
  incident: ['Incidents'],
  wiki: ['OSToolWiki', 'Knowledge'],
  repomap: ['RepoMaps'],
  note: [],   // any dir
};

export function knowledgeQuery(
  vault: ObsidianVault,
  input: KnowledgeQueryInput = {},
): KnowledgeQueryResult {
  const limit = clamp(Math.floor(input.limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const includeBody = input.include_body ?? false;

  let regex: RegExp | null = null;
  if (input.fulltext) {
    try { regex = new RegExp(input.fulltext, 'i'); }
    catch (err) {
      throw new Error(`knowledgeQuery: invalid fulltext regex — ${(err as Error).message}`);
    }
  }

  const kind: KnowledgeKind = input.kind ?? 'all';
  const tagsRequired = input.tags ?? [];

  const all: KnowledgeNote[] = [];
  walkMarkdown(vault.root, (absPath) => {
    let raw: string;
    try { raw = readFileSync(absPath, 'utf-8'); }
    catch { return; }
    const parsed = parseFrontmatter(raw);
    const fm = parsed.frontmatter;

    // kind filter
    if (kind !== 'all') {
      const hinted = KIND_DIR_HINTS[kind];
      const rel = relative(vault.root, absPath);
      const relPosix = rel.split(sep).join('/');
      const dirMatch = hinted.length === 0 || hinted.some((d) => relPosix.startsWith(`${d}/`));
      const fmMatch = (fm.kind as string | undefined) === kind;
      if (!dirMatch && !fmMatch) return;
    }

    // tags AND
    if (tagsRequired.length > 0) {
      const fmTags = fm.tags;
      if (!Array.isArray(fmTags)) return;
      const have = new Set((fmTags as unknown[]).filter((t): t is string => typeof t === 'string'));
      for (const required of tagsRequired) if (!have.has(required)) return;
    }

    // fulltext
    let excerpt = parsed.body.slice(0, EXCERPT_HEAD_CHARS);
    if (regex) {
      const m = regex.exec(parsed.body);
      if (!m) return;
      const s = Math.max(0, (m.index ?? 0) - EXCERPT_CONTEXT_CHARS);
      const e = Math.min(parsed.body.length, (m.index ?? 0) + m[0].length + EXCERPT_CONTEXT_CHARS);
      excerpt = parsed.body.slice(s, e);
    }

    const note: KnowledgeNote = {
      path: absPath,
      relPath: relative(vault.root, absPath).split(sep).join('/'),
      frontmatter: fm,
      excerpt,
      ...(includeBody ? { body: parsed.body } : {}),
    };
    all.push(note);
  });

  // Deterministic ordering: most recently modified first (falls back to path).
  all.sort((a, b) => {
    const amt = safeMtime(a.path);
    const bmt = safeMtime(b.path);
    if (amt !== bmt) return bmt - amt;
    return a.path.localeCompare(b.path);
  });

  const sliced = all.slice(offset, offset + limit);
  return {
    results: sliced,
    total: all.length,
    truncated: all.length > offset + limit,
  };
}

function safeMtime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

function walkMarkdown(dir: string, visit: (path: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) walkMarkdown(full, visit);
      else if (entry.endsWith('.md')) visit(full);
    } catch { /* ignore broken entries */ }
  }
}
