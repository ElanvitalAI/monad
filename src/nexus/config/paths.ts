// NEXUS · config / secrets paths (Phase N-3 PR μ)
//
// User-edited config and secrets live next to the daemon dir so admin
// tooling can manage them with one mental model. Tests override via
// the central `setMonadConfigDir()` helper (or the legacy
// `MONAD_DAEMON_DIR` env var, which now emits a deprecation nudge).

import { join as joinPath } from 'node:path';
import { getMonadConfigDir } from '../../monad-config-dir.js';

export function monadConfigDir(): string {
  return getMonadConfigDir();
}

export function userConfigPath(): string {
  return joinPath(monadConfigDir(), 'config.json');
}

export function secretsPath(): string {
  return joinPath(monadConfigDir(), 'secrets.json');
}
