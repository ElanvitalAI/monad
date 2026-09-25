// NEXUS · 1Password backend (Phase N-3.5 PR υ)
//
// Uses the `op` CLI. Each secret is stored as an item of category
// "Password" with title=<id> in the configured vault. `op read` syntax
// (`op://vault/title/credential`) is used for fast get without parsing
// JSON.
//
// Vault must be specified via `global.secrets.1password.vault` (no
// safe default — we don't want to silently write into the user's
// "Personal" vault).

import type { SecretBackend, SecretBackendAvailability } from './types.js';
import { runCli, type RunCli } from './cli-helper.js';

export interface OnePasswordBackendOpts {
  vault: string;
  /** Optional 1Password account shorthand (`op signin --account` value). */
  account?: string;
  runCliImpl?: RunCli;
}

export function createOnePasswordBackend(opts: OnePasswordBackendOpts): SecretBackend {
  const cli = opts.runCliImpl ?? runCli;
  const baseArgs: string[] = [];
  if (opts.account) baseArgs.push('--account', opts.account);

  return {
    id: '1password',
    async isAvailable(): Promise<SecretBackendAvailability> {
      if (!opts.vault || opts.vault.length === 0) {
        return { ok: false, reason: 'global.secrets.1password.vault is required' };
      }
      const v = await cli(['op', '--version', ...baseArgs], { timeoutMs: 1000 });
      if (v.exitCode === 127) return { ok: false, reason: '`op` CLI not in PATH (install from 1password.com/downloads/command-line)' };
      if (v.exitCode !== 0) return { ok: false, reason: `op --version failed: ${v.stderr.trim()}` };
      return { ok: true };
    },
    async get(id) {
      const ref = `op://${opts.vault}/${id}/credential`;
      const r = await cli(['op', 'read', ref, ...baseArgs]);
      if (r.exitCode !== 0) return undefined;
      return r.stdout.replace(/\n$/, '');
    },
    async set(id, value) {
      // Try edit first; if item missing, create.
      const editArgs = [
        'op', 'item', 'edit', id,
        '--vault', opts.vault,
        `credential[password]=${value}`,
        ...baseArgs,
      ];
      const edit = await cli(editArgs);
      if (edit.exitCode === 0) return;
      // create
      const createArgs = [
        'op', 'item', 'create',
        '--category', 'Password',
        '--vault', opts.vault,
        '--title', id,
        `credential[password]=${value}`,
        ...baseArgs,
      ];
      const create = await cli(createArgs);
      if (create.exitCode !== 0) {
        throw new Error(`1password set failed: ${create.stderr.trim() || edit.stderr.trim()}`);
      }
    },
    async delete(id) {
      const r = await cli(['op', 'item', 'delete', id, '--vault', opts.vault, ...baseArgs]);
      return r.exitCode === 0;
    },
    async list() {
      const r = await cli(['op', 'item', 'list', '--vault', opts.vault, '--format', 'json', ...baseArgs]);
      if (r.exitCode !== 0) return [];
      try {
        const parsed = JSON.parse(r.stdout) as Array<{ title?: string }>;
        return parsed.map((item) => item.title ?? '').filter(Boolean);
      } catch { return []; }
    },
  };
}
