// Archon-port T2.2 (2026-05-08) — workflow storage + discovery.
//
// Three sources, project > global > builtin precedence (Archon parity):
//   1. <cwd>/.monad/workflows/*.yaml      — project-local, git committable
//   2. ~/.monad/workflows/*.yaml          — user global
//   3. samples/workflows/*.yaml           — repo-bundled built-ins
//
// Same name in multiple sources → project wins, builtin loses (the
// caller can still inspect all entries via listAllSources). Pure read
// path — write/delete go through `storage.ts`.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { getMonadConfigDir } from '../monad-config-dir.js';
import { parseWorkflowYaml } from './parser.js';
import type { ValidationResult } from './schema.js';
import type { WorkflowDefinition, WorkflowEntry, WorkflowSource } from './types.js';

/** Built-in samples shipped with monad. Resolves at runtime via the
 *  module dirname so source-tree and bun-built CLIs both find it. */
function builtinDir(): string {
  // import.meta.dir is the directory of this file (`src/workflow-runtime`).
  // `../../samples/workflows` resolves to repo root in dev; in compiled
  // builds the bundler should preserve this layout (samples shipped).
  return join(import.meta.dir, '..', '..', 'samples', 'workflows');
}

export function getProjectWorkflowDir(cwd: string = process.cwd()): string {
  return join(cwd, '.monad', 'workflows');
}

export function getGlobalWorkflowDir(): string {
  // Routes through the central config-dir resolver so the
  // `--config-dir <dir>` CLI flag, programmatic `setMonadConfigDir()`,
  // and the legacy `MONAD_DAEMON_DIR` env var all map a test /
  // isolated daemon's registered workflows away from the user's
  // real `~/.monad/workflows/`.
  return join(getMonadConfigDir(), 'workflows');
}

export function getBuiltinWorkflowDir(): string {
  return builtinDir();
}

interface DiscoverOpts {
  cwd?: string;
  /** When true, every source's matching file is returned (caller-owned
   *  precedence). Default false — only the highest-precedence entry
   *  per workflow name. */
  includeShadowed?: boolean;
}

/** List all valid workflows visible from the given cwd. Invalid YAML
 *  files emit a warning to console.warn but are otherwise silently
 *  skipped (they remain visible to validateWorkflowFile for the UI). */
export function discoverWorkflows(opts: DiscoverOpts = {}): WorkflowEntry[] {
  const cwd = opts.cwd ?? process.cwd();
  const sources: { source: WorkflowSource['source']; dir: string }[] = [
    { source: 'project', dir: getProjectWorkflowDir(cwd) },
    { source: 'global', dir: getGlobalWorkflowDir() },
    { source: 'builtin', dir: getBuiltinWorkflowDir() },
  ];

  const seenNames = new Set<string>();
  const results: WorkflowEntry[] = [];

  for (const { source, dir } of sources) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch {
      continue;
    }
    for (const filename of files) {
      const filePath = join(dir, filename);
      try {
        if (!statSync(filePath).isFile()) continue;
      } catch {
        continue;
      }
      const yaml = readFileSync(filePath, 'utf-8');
      const parsed = parseWorkflowYaml(yaml);
      if (!parsed.ok || !parsed.workflow) {
        if (typeof console !== 'undefined') {
          console.warn(
            `workflow.discovery: skip invalid '${filePath}' — ${parsed.issues
              .slice(0, 3)
              .map(i => i.message)
              .join('; ')}`,
          );
        }
        continue;
      }
      const name = parsed.workflow.name;
      if (!opts.includeShadowed && seenNames.has(name)) continue;
      seenNames.add(name);
      results.push({
        source: { source, path: filePath },
        definition: parsed.workflow,
      });
    }
  }

  return results;
}

/** Find a workflow by name, applying the project > global > builtin
 *  precedence. Returns undefined when no match exists. */
export function findWorkflow(
  name: string,
  cwd?: string,
): WorkflowEntry | undefined {
  const all = discoverWorkflows({ cwd: cwd ?? process.cwd() });
  return all.find(w => w.definition.name === name);
}

/** Validate a single file path without loading the discovery cache.
 *  Used by the PUT /v1/workflows/{name} endpoint and the editor's
 *  live validation. */
export function validateWorkflowFile(filePath: string): ValidationResult {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      issues: [{ path: '', message: `file not found: ${filePath}` }],
      warnings: [],
    };
  }
  return parseWorkflowYaml(readFileSync(filePath, 'utf-8'));
}

/** Snapshot what's actually on disk per source for a given name —
 *  useful for the UI when a workflow is shadowed. */
export function listAllSourcesForName(
  name: string,
  cwd: string = process.cwd(),
): { source: WorkflowSource['source']; path: string; definition?: WorkflowDefinition }[] {
  const dirs: { source: WorkflowSource['source']; dir: string }[] = [
    { source: 'project', dir: getProjectWorkflowDir(cwd) },
    { source: 'global', dir: getGlobalWorkflowDir() },
    { source: 'builtin', dir: getBuiltinWorkflowDir() },
  ];
  const out: ReturnType<typeof listAllSourcesForName> = [];
  for (const { source, dir } of dirs) {
    if (!existsSync(dir)) continue;
    for (const candidate of [`${name}.yaml`, `${name}.yml`]) {
      const filePath = join(dir, candidate);
      if (!existsSync(filePath)) continue;
      const parsed = parseWorkflowYaml(readFileSync(filePath, 'utf-8'));
      if (parsed.ok && parsed.workflow && parsed.workflow.name === name) {
        out.push({ source, path: filePath, definition: parsed.workflow });
      } else if (basename(filePath, '.yaml').replace(/\.yml$/, '') === name) {
        // File path matches name but YAML parse failed — surface anyway.
        out.push({ source, path: filePath });
      }
    }
  }
  return out;
}
