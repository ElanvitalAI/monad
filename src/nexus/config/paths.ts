// NEXUS · config / secrets paths (Phase N-3 PR μ)
//
// User-edited config and secrets live next to the daemon dir so admin
// tooling can manage them with one mental model. Tests override via
// the central `setElanousConfigDir()` helper (or the legacy
// `ELANOUS_DAEMON_DIR` env var, which now emits a deprecation nudge).

import { join as joinPath } from 'node:path';
import { getElanousConfigDir } from '../../elanous-config-dir.js';

export function elanousConfigDir(): string {
  return getElanousConfigDir();
}

export function userConfigPath(): string {
  return joinPath(elanousConfigDir(), 'config.json');
}

export function secretsPath(): string {
  return joinPath(elanousConfigDir(), 'secrets.json');
}
