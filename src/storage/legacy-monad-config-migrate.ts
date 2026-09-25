// Phase 3 (PLAN-config-unification-monad-root-2026-05-10):
//   Once-per-process migration of ~/.config/monad/config.json (Path A ·
//   19 root keys) into ~/.monad/config.json (Path B · NEXUS schema).
//
// Triggered eagerly from `userConfigPath()` so every CLI / daemon entry
// point sees the post-migration state. Idempotent: if Path A keys are
// already present at the unified file's root, the call is a no-op.
//
// Behavior:
//   - XDG_CONFIG_HOME explicit          → skip (legacy honor · user opted in)
//   - ~/.config/monad/config.json absent → skip
//   - Any Path A key already at unified root → skip (don't clobber newer state)
//   - Otherwise: top-level merge (Path A keys onto unified file) + atomic
//     tmp+rename + chmod 0o600 + legacy → .bak rename
//
// Top-level namespace collision = 0 verified at PLAN audit (Path A 19
// keys: skillRouter / llm / skills / obsidian / telegram / discord /
// onboarding / debug / shell / chat / voice / intake / dashboard / vw /
// acp / lsp / plan / goals / raw vs Path B 3 keys: version / global /
// tabs). Defensive idempotency check guards against a future schema
// drift.

import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const NEXUS_KEYS = new Set(['version', 'global', 'tabs']);

let migrated = false;

function resolveHome(): string {
  const testHome = process.env.MONAD_TEST_HOME?.trim();
  if (testHome) return testHome;
  return homedir();
}

export function migrateLegacyXdgUserConfig(): void {
  if (migrated) return;
  migrated = true;

  // Legacy XDG honor: if the user opted in via env, leave their layout
  // alone — Phase 6 emits a deprecation warning instead.
  if (process.env.XDG_CONFIG_HOME?.trim()) return;

  const home = resolveHome();
  const oldPath = join(home, '.config', 'monad', 'config.json');
  const newPath = join(home, '.monad', 'config.json');

  if (!existsSync(oldPath)) return;

  let oldJson: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(oldPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    oldJson = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  // Filter to Path A keys (everything that is NOT NEXUS schema · top-level).
  const pathAKeys: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(oldJson)) {
    if (NEXUS_KEYS.has(k)) continue;
    pathAKeys[k] = v;
  }

  // Nothing to migrate (e.g. legacy file only had NEXUS keys for some reason).
  if (Object.keys(pathAKeys).length === 0) {
    try { renameSync(oldPath, oldPath + '.bak'); } catch { /* hygiene */ }
    return;
  }

  let newJson: Record<string, unknown> = {};
  if (existsSync(newPath)) {
    try {
      const parsed = JSON.parse(readFileSync(newPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        newJson = parsed as Record<string, unknown>;
      }
    } catch {
      // Treat malformed unified file as empty · merge from Path A is the
      // source of truth in that case.
    }
  }

  // Idempotency: if any Path A key already lives at the unified root,
  // skip — second boot, or user manually merged. Don't clobber.
  for (const k of Object.keys(pathAKeys)) {
    if (k in newJson) return;
  }

  const merged: Record<string, unknown> = { ...newJson, ...pathAKeys };

  // Atomic write at the unified path · 0o600 (file may carry secrets).
  mkdirSync(dirname(newPath), { recursive: true });
  const tmp = newPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  renameSync(tmp, newPath);
  try { chmodSync(newPath, 0o600); } catch { /* best-effort */ }

  // Soft-deprecate legacy file: rename to .bak so it stays as a manual
  // recovery anchor (PLAN Q3 = soft deprecation · permanent retention).
  try { renameSync(oldPath, oldPath + '.bak'); } catch { /* hygiene */ }
}

export function __resetMonadConfigMigrateForTests(): void {
  migrated = false;
}
