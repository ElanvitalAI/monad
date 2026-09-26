/**
 * Generic localStorage key migration helper.
 *
 * Originally extracted from `daemon-config.ts:48-58` (legacy
 * `elanous.voice.wsUrl` → `elanous.daemon.baseUrl` migration). NEXUS
 * cleanup arc N-1.5 PR a re-uses the same pattern for
 * `elanous.daemon.baseUrl` → `elanous.nexus.baseUrl` cutover.
 *
 * Behaviour: read legacyKey, if present and currentKey absent,
 * optionally transform, write to currentKey, then drop the legacy key.
 * One-shot — once currentKey exists, future loads are no-ops.
 *
 * Throws never — invalid transform results silently abort the migration
 * (legacy key kept in place so the user can retry). The caller is
 * responsible for falling through to a default value when both keys
 * are absent.
 */

export interface MigrateBaseUrlInput {
  legacyKey: string;
  currentKey: string;
  /** Optional value normaliser. Return null to abort migration silently
   *  (e.g., the legacy value is invalid). */
  transformValue?: (legacyValue: string) => string | null;
}

export interface MigrateBaseUrlResult {
  /** True iff a value was copied legacy → current this call. */
  migrated: boolean;
  /** The value present at currentKey after the call (post-migration). */
  currentValue: string | null;
}

export function migrateBaseUrl(input: MigrateBaseUrlInput): MigrateBaseUrlResult {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { migrated: false, currentValue: null };
  }
  const existing = localStorage.getItem(input.currentKey);
  if (existing && existing.length > 0) {
    return { migrated: false, currentValue: existing };
  }
  const legacy = localStorage.getItem(input.legacyKey);
  if (!legacy || legacy.length === 0) {
    return { migrated: false, currentValue: existing };
  }
  let next: string | null = legacy;
  if (input.transformValue) {
    try {
      next = input.transformValue(legacy);
    } catch {
      next = null;
    }
  }
  if (!next || next.length === 0) {
    return { migrated: false, currentValue: existing };
  }
  try {
    localStorage.setItem(input.currentKey, next);
    localStorage.removeItem(input.legacyKey);
  } catch {
    return { migrated: false, currentValue: existing };
  }
  return { migrated: true, currentValue: next };
}
