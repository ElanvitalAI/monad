import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { debug } from '../debug/log.js';
import { getUserConfig, type UserConfig } from '../user-config.js';

/** Why `resolveGoalDocumentsDir` picked the directory it returned. */
export type GoalDocumentsDirReason = 'config' | 'existing-docs-goals' | 'default-dot-monad';

export interface ResolvedGoalDocumentsDir {
  /** Absolute directory that holds authored goal documents for this repository. */
  directory: string;
  reason: GoalDocumentsDirReason;
}

export interface ResolveGoalDocumentsDirDeps {
  /** Reads `harness.goalsDir`. Defaults to the process user config. */
  readConfig?: (repoRoot: string) => UserConfig;
  /** Directory existence probe. Defaults to `existsSync`. */
  exists?: (path: string) => boolean;
  /** Resolution observation. Defaults to `debug.log`. */
  log?: (category: string, event: string, data?: unknown) => void;
}

const DOCS_GOALS = ['docs', 'goals'] as const;

/**
 * One place that decides where goal documents live.
 *
 * Precedence:
 * 1. `harness.goalsDir` — a repository-root-relative path in user config.
 * 2. `<repoRoot>/docs/goals` when that directory already exists (monad and existing users).
 * 3. `<repoRoot>/.monad/goals` otherwise. `.monad/` is already gitignored by repo-provision.
 */
export function resolveGoalDocumentsDir(
  repoRoot: string,
  deps: ResolveGoalDocumentsDirDeps = {},
): ResolvedGoalDocumentsDir {
  const root = resolve(repoRoot);
  const readConfig = deps.readConfig ?? (() => getUserConfig());
  const exists = deps.exists ?? existsSync;
  const log = deps.log ?? ((category, event, data) => debug.log(category, event, data));

  const configured = configuredGoalsDir(readConfig(root), root);
  const resolved = configured
    ?? (exists(join(root, ...DOCS_GOALS))
      ? { directory: join(root, ...DOCS_GOALS), reason: 'existing-docs-goals' as const }
      : { directory: join(root, '.monad', 'goals'), reason: 'default-dot-monad' as const });

  log('harness.goals-dir', 'resolved', { repoRoot: root, directory: resolved.directory, reason: resolved.reason });
  return resolved;
}

/** `harness.goalsDir` only counts when it is a non-empty path inside the repository root. */
function configuredGoalsDir(
  config: UserConfig,
  repoRoot: string,
): ResolvedGoalDocumentsDir | undefined {
  const harness = config.raw.harness;
  if (!harness || typeof harness !== 'object' || Array.isArray(harness)) return undefined;
  const goalsDir = (harness as Record<string, unknown>).goalsDir;
  if (typeof goalsDir !== 'string') return undefined;
  const trimmed = goalsDir.trim();
  if (!trimmed || isAbsolute(trimmed)) return undefined;
  const directory = resolve(repoRoot, trimmed);
  const rel = relative(repoRoot, directory);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return { directory, reason: 'config' };
}
