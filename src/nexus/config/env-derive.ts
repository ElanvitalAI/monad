// NEXUS · child-env derivation (Phase N-3 PR μ)
//
// Walks the SwitchRegistry, computes each switch's effective value from
// UserConfig (with secret-ref expansion), and assembles the env map the
// supervisor's spawn primitive should pass to the child.
//
// Resolution priority (per switch):
//   1. UserConfig switch value (read via switch id)
//   2. secret-ref → readSecrets().secrets[<id>]
//   3. legacy MONAD_* env (D-13 backwards-compat path; deprecation log
//      surfaces via env-migrate.ts at boot)
//   4. switch.default
//
// Empty / null / undefined results are skipped (no env entry written).

import { listSwitches, expandTabSwitchId } from './switch-registry.js';
import { readSwitchValue } from './user-config.js';
import { isSecretRef, secretIdFromRef, type SecretsFile, type SwitchSpec, type UserConfig } from './types.js';
import type { TabState } from '../kinds/types.js';

export interface DeriveEnvOpts {
  tab: TabState;
  config: UserConfig;
  secrets: SecretsFile;
  /** When true, fall back to process.env[switch.legacyEnvName] for any
   *  switch whose effective value is empty. Default true (D-13 = A
   *  during the deprecation window). */
  legacyEnvFallback?: boolean;
}

export function deriveChildEnv(opts: DeriveEnvOpts): Record<string, string> {
  const env: Record<string, string> = {};
  const fallback = opts.legacyEnvFallback ?? true;

  for (const sw of listSwitches()) {
    if (!sw.envName) continue;
    if (!appliesToTab(sw, opts.tab)) continue;
    const literalId = sw.scope === 'tab' ? expandTabSwitchId(sw.id, opts.tab.spec.id) : sw.id;
    let value = readSwitchValue(opts.config, literalId);
    if (isSecretRef(value)) {
      const secretId = secretIdFromRef(value);
      value = secretId != null ? opts.secrets.secrets[secretId] : undefined;
    }
    if (value == null || value === '') {
      if (fallback && sw.legacyEnvName) {
        const legacy = process.env[sw.legacyEnvName];
        if (legacy && legacy.length > 0) value = legacy;
      }
    }
    if (value == null || value === '') continue;
    env[sw.envName] = String(value);
  }

  return env;
}

function appliesToTab(sw: SwitchSpec, tab: TabState): boolean {
  if (sw.scope === 'global') return true;
  if (sw.scope === 'tab') {
    if (!sw.appliesTo) return true;
    return sw.appliesTo.includes(tab.spec.kind);
  }
  return false;
}
