// Step 5 PR γ — env deprecation warning + SDK-first resolver helpers.
//
// PLAN-step5-sdk-zero-env.md §1 D-Phase3-D: env override stays
// supported, but every read emits a per-process per-key stderr
// warning so the user knows the SDK has the same value baked in.
//
// Surfaces import these helpers instead of reading process.env
// directly. The helpers:
//   - Read env first.
//   - Emit a warning once if env is set.
//   - Return null when env is absent — caller falls back to SDK.
//
// Centralizing the warning here means we can flip the format /
// message wording in one place when the deprecation moves from
// "warn" → "SDK first" → "SDK only".

import { debug } from '../debug/log.js';

const warned: Set<string> = new Set();

interface DeprecatedEnvKey {
  key: string;
  /** Replacement guidance in the warning message — usually "the SDK
   *  resolves this automatically". */
  replacement: string;
}

const DEPRECATED_ENV_KEYS: Record<string, DeprecatedEnvKey> = {
  ELANOUS_REMOTE: {
    key: 'ELANOUS_REMOTE',
    replacement: 'elanous attach (SDK auto-discovers remote daemons via control plane)',
  },
  ELANOUS_RESUME_SESSION: {
    key: 'ELANOUS_RESUME_SESSION',
    replacement: 'elanous attach --session <id> or rely on the SDK\'s active-session resolver',
  },
  ELANOUS_TOKEN: {
    key: 'ELANOUS_TOKEN',
    replacement: '~/.elanous/acp-token (raw or envelope) — SDK reads it automatically',
  },
  ELANOUS_TELEGRAM_VIA_DAEMON: {
    key: 'ELANOUS_TELEGRAM_VIA_DAEMON',
    replacement: 'control plane registry — daemons + bots auto-discover each other',
  },
  ELANOUS_DISCORD_VIA_DAEMON: {
    key: 'ELANOUS_DISCORD_VIA_DAEMON',
    replacement: 'control plane registry — daemons + bots auto-discover each other',
  },
};

/** Emit a one-time stderr deprecation warning for a known env key.
 *  Subsequent calls with the same key are no-ops. Tests reset via
 *  `__resetEnvWarnings()`. */
export function warnDeprecatedEnv(key: string): void {
  if (warned.has(key)) return;
  warned.add(key);

  const meta = DEPRECATED_ENV_KEYS[key];
  if (!meta) return;

  // stderr so a captured stdout (scripts piping elanous output) stays
  // clean. The warning is informational — never cause an exit.
  // Format mirrors `ELANOUS_TOOLS=readonly` style hints elsewhere.
  process.stderr.write(
    `[elanous] notice: ${meta.key} is deprecated since Step 5 SDK landed. ` +
    `${meta.replacement}. The env override still works for now.\n`,
  );
  if (debug.enabled) debug.log('control-client.env.deprecated', meta.key);
}

/** Test helper — clears the per-process warning cache. */
export function __resetEnvWarnings(): void {
  warned.clear();
}

export interface ReadDeprecatedEnvResult {
  /** Trimmed env value, or null when unset / empty. */
  value: string | null;
  /** Whether the env was set (regardless of empty/whitespace). */
  wasSet: boolean;
}

/** Read a deprecated env var, emit the warning if present, and return
 *  the trimmed value. Wrapper around process.env.<key>?.trim() with
 *  the warning baked in so call sites can't forget to emit it. */
export function readDeprecatedEnv(key: string): ReadDeprecatedEnvResult {
  const raw = process.env[key];
  if (raw === undefined) return { value: null, wasSet: false };
  if (raw.trim() === '') {
    // Treat empty/whitespace as absent — same behavior as the
    // existing tui-client/remote-target.ts. Don't warn — empty env
    // is usually accidental.
    return { value: null, wasSet: true };
  }
  warnDeprecatedEnv(key);
  return { value: raw.trim(), wasSet: true };
}
