// PLAN-codex-app-server-hermes-parity §5 Phase H3·3 (2026-05-16) —
// orchestrate the `~/.codex/config.toml` migration. Read the existing
// file (or treat as empty when missing), generate the monad-tools
// managed section body, splice it via regenerateManagedBlock, and
// write back. Always create a `.bak.<timestamp>` snapshot before the
// first edit so the user can roll back without git.
//
// Pure async function — accepts fs + path overrides so tests don't
// need to touch the real ~/.codex.

import { readFile, writeFile, mkdir, stat as fsStat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  regenerateManagedBlock,
  removeManagedBlock,
} from './managed-block.js';
import {
  renderMonadToolsEntry,
  type MonadToolsEntryOpts,
} from './monad-tools-entry.js';

export interface MigrateCodexConfigOpts {
  /** Override `~/.codex/config.toml` path (tests). */
  configPath?: string;
  /** Entry-generator opts forwarded to renderMonadToolsEntry. */
  entry?: MonadToolsEntryOpts;
  /** `true` → strip the managed section instead of writing it. */
  remove?: boolean;
  /** Skip backup creation (tests only). */
  skipBackup?: boolean;
  /** Clock for backup filename suffix. Defaults to `Date.now()`. */
  now?: () => number;
}

export interface MigrateCodexConfigResult {
  configPath: string;
  action: 'wrote' | 'replaced' | 'removed' | 'no-op';
  backupPath?: string;
  /** New file content (what got written). */
  content: string;
}

export async function migrateCodexConfig(
  opts: MigrateCodexConfigOpts = {},
): Promise<MigrateCodexConfigResult> {
  const configPath = opts.configPath ?? join(homedir(), '.codex', 'config.toml');
  const now = opts.now ?? Date.now;

  let existing = '';
  let configExists = false;
  try {
    existing = await readFile(configPath, 'utf8');
    configExists = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // missing → treat as empty, ensure parent dir before writing
  }

  if (opts.remove) {
    const { content, removed } = removeManagedBlock(existing);
    if (!removed) {
      return { configPath, action: 'no-op', content: existing };
    }
    const backupPath = opts.skipBackup
      ? undefined
      : await writeBackup(configPath, existing, now);
    await ensureParent(configPath);
    await writeFile(configPath, content, 'utf8');
    return {
      configPath,
      action: 'removed',
      ...(backupPath ? { backupPath } : {}),
      content,
    };
  }

  const body = renderMonadToolsEntry(opts.entry);
  const { content, replaced } = regenerateManagedBlock(existing, body);
  if (content === existing) {
    return { configPath, action: 'no-op', content };
  }
  const backupPath =
    configExists && !opts.skipBackup
      ? await writeBackup(configPath, existing, now)
      : undefined;
  await ensureParent(configPath);
  await writeFile(configPath, content, 'utf8');
  return {
    configPath,
    action: replaced ? 'replaced' : 'wrote',
    ...(backupPath ? { backupPath } : {}),
    content,
  };
}

async function ensureParent(filePath: string): Promise<void> {
  const parent = dirname(filePath);
  try {
    await fsStat(parent);
  } catch {
    await mkdir(parent, { recursive: true });
  }
}

async function writeBackup(
  configPath: string,
  content: string,
  now: () => number,
): Promise<string> {
  const stamp = new Date(now())
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const backupPath = `${configPath}.bak-${stamp}`;
  await writeFile(backupPath, content, 'utf8');
  return backupPath;
}
