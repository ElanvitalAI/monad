// ── PFC-S4.3: KnowledgeWrite core ──
//
// Wraps Obsidian's atomic writeNote with:
//   - vault-boundary check (rel_path cannot escape via `..`/absolute)
//   - overwrite guard (default false)
//   - kind-based Poka-Yoke schema (required frontmatter fields)
//   - automatic tag / kind merge into frontmatter
//   - Poka-Yoke validation → atomic-write ONLY on pass

import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  writeNote,
  type ObsidianVault,
} from '../auto-research/obsidian-bridge.js';
import type { PokaSchema, ValidationFailure } from '../cft/pokayoke.js';
import { validate } from '../cft/pokayoke.js';
import type {
  KnowledgeKind,
  KnowledgeWriteInput,
  KnowledgeWriteResult,
} from './types.js';

type Kind = Exclude<KnowledgeKind, 'all'>;

/** Required-field schemas per kind. Paths shown as [`frontmatter`, key]. */
const KIND_SCHEMAS: Record<Kind, PokaSchema> = {
  incident: {
    kind: 'object',
    shape: {
      severity: { kind: 'enum', values: ['LOW', 'MED', 'HIGH', 'CRITICAL'] },
      title: { kind: 'string', min: 1 },
      resolved: { kind: 'boolean' },
    },
    required: ['severity', 'title', 'resolved'],
  },
  a3: {
    kind: 'object',
    shape: {
      problem: { kind: 'string', min: 1 },
      countermeasure: { kind: 'string', min: 1 },
      owner: { kind: 'string', min: 1 },
    },
    required: ['problem', 'countermeasure', 'owner'],
  },
  rca: {
    kind: 'object',
    shape: {
      root_cause: { kind: 'string', min: 1 },
      whys: { kind: 'array', of: { kind: 'string' }, min: 1 },
    },
    required: ['root_cause', 'whys'],
  },
  wiki: {
    kind: 'object',
    shape: {
      tool: { kind: 'string', min: 1 },
      summary: { kind: 'string', min: 1 },
    },
    required: ['tool', 'summary'],
  },
  repomap: {
    kind: 'object',
    shape: {
      repo: { kind: 'string', min: 1 },
      commit: { kind: 'string', min: 1 },
    },
    required: ['repo', 'commit'],
  },
  note: {
    kind: 'object',
    shape: {
      title: { kind: 'string', min: 1 },
    },
    required: ['title'],
  },
};

export function knowledgeWrite(
  vault: ObsidianVault,
  input: KnowledgeWriteInput,
): KnowledgeWriteResult {
  if (!input.rel_path || typeof input.rel_path !== 'string') {
    throw new Error('knowledgeWrite: rel_path is required');
  }
  if (typeof input.body !== 'string') {
    throw new Error('knowledgeWrite: body is required');
  }
  if (input.rel_path.startsWith('/')) {
    throw new Error(`knowledgeWrite: rel_path '${input.rel_path}' must be relative (no leading /)`);
  }
  const rel = input.rel_path;
  if (rel.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`knowledgeWrite: rel_path '${input.rel_path}' escapes vault`);
  }
  const abs = resolve(vault.root, rel);
  if (!abs.startsWith(vault.root + sep) && abs !== vault.root) {
    throw new Error(`knowledgeWrite: rel_path '${input.rel_path}' escapes vault`);
  }

  const overwrite = input.overwrite ?? false;
  if (!overwrite && existsSync(abs)) {
    throw new Error(`knowledgeWrite: file exists and overwrite=false — ${rel}`);
  }

  // Merge frontmatter
  const fm: Record<string, unknown> = {
    ...(input.frontmatter ?? {}),
  };
  if (input.kind && input.kind !== undefined) fm.kind = input.kind;
  if (input.tags) fm.tags = Array.isArray(fm.tags)
    ? [...(fm.tags as unknown[]), ...input.tags]
    : [...input.tags];

  // Schema validation
  const kind = input.kind;
  const strict = input.strict_schema ?? true;
  if (strict && kind) {
    const schema = KIND_SCHEMAS[kind];
    const result = validate(fm, schema);
    if (!result.ok) {
      const errors: ValidationFailure[] = result.errors;
      const reasonOneLine =
        `knowledgeWrite schema rejected ${rel}: ${errors.length} issue(s) — `
        + errors.slice(0, 3).map((e) => `${e.path.join('.')}:${e.code}`).join(', ')
        + (errors.length > 3 ? '…' : '');
      return {
        ok: false,
        reasonOneLine,
        errors: errors.map((e) => ({
          path: ['frontmatter', ...e.path],
          message: e.message,
          code: e.code,
        })),
      };
    }
  }

  // Atomic write via existing obsidian-bridge.
  writeNote(vault, rel, input.body, fm);
  return { ok: true, path: abs, relPath: rel };
}

/** Test helper — size of the KIND_SCHEMAS dict for assertion. */
export function _kindSchemaCountForTest(): number {
  return Object.keys(KIND_SCHEMAS).length;
}
