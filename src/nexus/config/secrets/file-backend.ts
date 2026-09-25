// NEXUS · FileBackend (Phase N-3.5 PR σ)
//
// Reads / writes `~/.monad/secrets.json` (0o600). Implementation moved
// from src/nexus/config/secrets.ts so the registry can swap backends
// without touching caller code. The legacy module re-exports this
// backend's accessor functions to preserve backwards compatibility.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SECRETS_VERSION, type SecretsFile } from '../types.js';
import { secretsPath } from '../paths.js';
import type { SecretBackend, SecretBackendAvailability, SyncReadableBackend } from './types.js';

function defaultSecrets(): SecretsFile {
  return { version: SECRETS_VERSION, secrets: {} };
}

function readSecretsFile(): SecretsFile {
  const path = secretsPath();
  if (!existsSync(path)) return defaultSecrets();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SecretsFile>;
    if (parsed.version !== SECRETS_VERSION) return defaultSecrets();
    return {
      version: SECRETS_VERSION,
      secrets: (parsed.secrets ?? {}) as Record<string, string>,
    };
  } catch {
    return defaultSecrets();
  }
}

function writeSecretsFile(s: SecretsFile): void {
  const path = secretsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
}

const syncReadable: SyncReadableBackend = {
  getSync(id) { return readSecretsFile().secrets[id]; },
  listSync() { return Object.keys(readSecretsFile().secrets); },
};

export const fileBackend: SecretBackend = {
  id: 'file',
  async get(id) { return syncReadable.getSync(id); },
  async set(id, value) {
    const s = readSecretsFile();
    s.secrets[id] = value;
    writeSecretsFile(s);
  },
  async delete(id) {
    const s = readSecretsFile();
    if (!(id in s.secrets)) return false;
    delete s.secrets[id];
    writeSecretsFile(s);
    return true;
  },
  async list() { return syncReadable.listSync(); },
  async isAvailable(): Promise<SecretBackendAvailability> {
    // FileBackend is always available — the file system is part of the
    // OS contract. Returns ok=true even when the file doesn't yet exist
    // (a write will create it).
    return { ok: true };
  },
  syncReadable,
};

/** Convenience for callers that want the raw SecretsFile object (the
 *  pre-PR σ patten). Equivalent to fileBackend + manual file read. */
export function readSecretsFileRaw(): SecretsFile {
  return readSecretsFile();
}

export function writeSecretsFileRaw(s: SecretsFile): void {
  writeSecretsFile(s);
}
