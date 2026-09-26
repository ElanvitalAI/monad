// NEXUS · legacy ELANOUS_* env auto-migration (Phase N-3 PR μ · D-13=A)
//
// At boot, scan SwitchRegistry for switches with `legacyEnvName`. For
// each one whose env is set in process.env AND whose UserConfig value
// is currently empty:
//   - secret-ref switches: write the env value into a fresh secret with
//     id = `${tabId}_${switchTail}` (e.g., `telegram:1_tokenRef`), then
//     set the switch value to `ref:secret:<id>`.
//   - other switches: write the env value directly into UserConfig.
//
// In both cases, emit a deprecation event so the user sees the migration.
// Per D-13 the legacy env is still honored at runtime (env-derive
// fallback) for one release; this migration just persists the value so
// the user can clear the env and not lose anything.

import { patchUserConfig, readSwitchValue, writeSwitchValue } from './user-config.js';
import { setSecret } from './secrets.js';
import { listSwitches, expandTabSwitchId } from './switch-registry.js';
import { makeSecretRef, type UserConfig } from './types.js';
import { pushEvent, type NexusState } from '../state/state.js';
import { debug } from '../../debug/log.js';
import type { TabState } from '../kinds/types.js';

export interface EnvMigrateResult {
  migrated: { switchId: string; legacyEnvName: string; tabId?: string; storedAsSecretId?: string }[];
  skipped: { switchId: string; reason: string }[];
}

export interface EnvMigrateOpts {
  state: NexusState;
  /** All currently-registered tabs (used to expand tab-scope switches). */
  tabs: TabState[];
  /** Test seam — defaults to process.env. */
  envSource?: NodeJS.ProcessEnv;
}

export function migrateLegacyEnvToConfig(opts: EnvMigrateOpts): EnvMigrateResult {
  const env = opts.envSource ?? process.env;
  const result: EnvMigrateResult = { migrated: [], skipped: [] };

  // Collect candidate (switch, tabId?) pairs we'd need to populate.
  const candidates: { switchId: string; tabId?: string; switchTail: string; legacyEnvName: string; isSecretRef: boolean }[] = [];

  for (const sw of listSwitches()) {
    if (!sw.legacyEnvName) continue;
    if (env[sw.legacyEnvName] === undefined || env[sw.legacyEnvName] === '') continue;

    if (sw.scope === 'global') {
      candidates.push({
        switchId: sw.id,
        switchTail: sw.id.split('.').slice(1).join('.'),
        legacyEnvName: sw.legacyEnvName,
        isSecretRef: sw.kind === 'secret-ref',
      });
    } else if (sw.scope === 'tab') {
      // Apply to every currently-registered tab whose kind matches.
      for (const tab of opts.tabs) {
        if (sw.appliesTo && !sw.appliesTo.includes(tab.spec.kind)) continue;
        candidates.push({
          switchId: expandTabSwitchId(sw.id, tab.spec.id),
          tabId: tab.spec.id,
          switchTail: sw.id.split('.').slice(2).join('.'),
          legacyEnvName: sw.legacyEnvName,
          isSecretRef: sw.kind === 'secret-ref',
        });
      }
    }
  }

  // Read current config once; we apply patches in a single round-trip.
  const cfg = patchUserConfig((c) => {
    for (const cand of candidates) {
      const existing = readSwitchValue(c as UserConfig, cand.switchId);
      if (existing !== undefined && existing !== '') {
        result.skipped.push({ switchId: cand.switchId, reason: 'already-set' });
        continue;
      }
      const value = env[cand.legacyEnvName]!;
      if (cand.isSecretRef) {
        // Persist the secret outside the patch (writeSecrets is its own file).
        const secretId = secretIdFromMigration(cand.tabId, cand.switchTail);
        // Defer secret write to after patchUserConfig so we don't keep a
        // file handle open mid-mutate. We push to a side list.
        secretWritesQueued.push({ id: secretId, value });
        writeSwitchValue(c as UserConfig, cand.switchId, makeSecretRef(secretId));
        result.migrated.push({
          switchId: cand.switchId,
          legacyEnvName: cand.legacyEnvName,
          ...(cand.tabId ? { tabId: cand.tabId } : {}),
          storedAsSecretId: secretId,
        });
      } else {
        writeSwitchValue(c as UserConfig, cand.switchId, value);
        result.migrated.push({
          switchId: cand.switchId,
          legacyEnvName: cand.legacyEnvName,
          ...(cand.tabId ? { tabId: cand.tabId } : {}),
        });
      }
    }
  });

  // Drain the queued secret writes (post-config persistence).
  for (const sw of secretWritesQueued.splice(0)) {
    setSecret(sw.id, sw.value);
  }

  if (result.migrated.length > 0) {
    pushEvent(opts.state, {
      kind: 'config.changed',
      detail: {
        reason: 'env-migrate',
        migratedCount: result.migrated.length,
        switches: result.migrated.map((m) => m.switchId),
        deprecation: 'ELANOUS_* env vars are deprecated; values were copied to ~/.elanous/config.json (and ~/.elanous/secrets.json for tokens). They will be ignored in a future release.',
      },
    });
    if (debug.enabled) {
      debug.log('nexus.config.env-migrate', String(result.migrated.length), {
        switches: result.migrated.map((m) => m.switchId),
      });
    }
  }
  // Touch cfg to avoid lint complaints (it's already persisted).
  void cfg;
  return result;
}

const secretWritesQueued: { id: string; value: string }[] = [];

function secretIdFromMigration(tabId: string | undefined, switchTail: string): string {
  const safeTab = tabId ? tabId.replace(/[:/\\]/g, '_') : 'global';
  return `${safeTab}__${switchTail}`;
}

/** Helper exported for tests — checks whether a value already looks
 *  migrated (so we don't double-count subsequent runs). */
export function isAlreadyMigrated(value: unknown): boolean {
  if (value === undefined || value === '') return false;
  if (typeof value === 'string') {
    const s: string = value;
    return s.startsWith('ref:secret:') || s.length > 0;
  }
  return true;
}
