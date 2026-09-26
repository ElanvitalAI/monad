// NEXUS · macOS Keychain backend (Phase N-3.5 PR υ)
//
// Uses the `security` CLI (preinstalled on macOS) to store secrets
// under account `elanous` and service name = secret id. List support is
// best-effort: `security` doesn't expose a clean filter, so we maintain
// a sidecar JSON index of known ids (`~/.elanous/secrets-keychain-index.json`,
// 0o600). Lookups go straight to keychain (sidecar is metadata-only).
//
// **Linux/Windows**: isAvailable() returns ok=false with a clear reason.

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { join as joinPath } from 'node:path';
import type { SecretBackend, SecretBackendAvailability } from './types.js';
import { runCli, type RunCli } from './cli-helper.js';
import { elanousConfigDir } from '../paths.js';

const ACCOUNT = 'elanous';

export interface KeychainBackendOpts {
  /** Test seam — defaults to the real spawn-based runCli. */
  runCliImpl?: RunCli;
  /** Override the index file path (tests). */
  indexPath?: string;
  /** Override platform check (tests can set 'darwin' on Linux). */
  platformOverride?: string;
}

export function createKeychainBackend(opts: KeychainBackendOpts = {}): SecretBackend {
  const cli = opts.runCliImpl ?? runCli;
  const indexPath = opts.indexPath ?? joinPath(elanousConfigDir(), 'secrets-keychain-index.json');
  const platform = opts.platformOverride ?? process.platform;

  function readIndex(): string[] {
    if (!existsSync(indexPath)) return [];
    try {
      const raw = readFileSync(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as { ids?: string[] };
      return Array.isArray(parsed.ids) ? parsed.ids : [];
    } catch { return []; }
  }

  function writeIndex(ids: string[]): void {
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, JSON.stringify({ ids: [...new Set(ids)].sort() }, null, 2), { mode: 0o600 });
  }

  return {
    id: 'keychain',
    async isAvailable(): Promise<SecretBackendAvailability> {
      if (platform !== 'darwin') {
        return { ok: false, reason: `keychain backend is macOS-only (platform=${platform})` };
      }
      const result = await cli(['security', '-h'], { timeoutMs: 1000 });
      if (result.exitCode === 127) return { ok: false, reason: '`security` CLI not in PATH' };
      return { ok: true };
    },
    async get(id) {
      const result = await cli(['security', 'find-generic-password', '-a', ACCOUNT, '-s', id, '-w']);
      if (result.exitCode !== 0) return undefined;
      // -w prints value followed by trailing newline
      return result.stdout.replace(/\n$/, '');
    },
    async set(id, value) {
      // -U updates if it exists; -w supplies the value.
      const result = await cli([
        'security', 'add-generic-password',
        '-a', ACCOUNT, '-s', id, '-w', value, '-U',
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`keychain set failed (${result.exitCode}): ${result.stderr.trim()}`);
      }
      const ids = readIndex();
      if (!ids.includes(id)) writeIndex([...ids, id]);
    },
    async delete(id) {
      const result = await cli(['security', 'delete-generic-password', '-a', ACCOUNT, '-s', id]);
      const ok = result.exitCode === 0;
      const ids = readIndex();
      if (ids.includes(id)) writeIndex(ids.filter((x) => x !== id));
      return ok;
    },
    async list() { return readIndex(); },
    /** Best-effort cleanup helper for tests + admin commands. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(undefined as any),
  };
}

/** Test seam — drop the index file. */
export function deleteKeychainIndex(opts: { indexPath?: string } = {}): void {
  const path = opts.indexPath ?? joinPath(elanousConfigDir(), 'secrets-keychain-index.json');
  try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
}
