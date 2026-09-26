// Transfer target registry — T5-J1.
//
// When the user presses `t` in the browser pane, they pick a
// destination for the focused (or selected) file(s). This module
// defines the destination types + loads per-user overrides from
// ~/.config/monad-agent/transfer-targets.json.
//
// Defaults seed:
//   • SSH: every host from ssh-hosts.ts, destination ~/Downloads/
//   • iPhone: one entry assuming tailscale TailDrop is available
//
// Override file shape:
//
//   {
//     "targets": [
//       { "kind": "ssh",    "name": "backup",  "host": "mba",
//         "remoteDir": "~/Transfers/" },
//       { "kind": "iphone", "name": "My iPhone",
//         "tailscaleHost": "iphone.tail-abcd.ts.net",
//         "pushcutName": "elanous-file-received" }
//     ]
//   }
//
// Entries with `kind: "ssh"` must reference a known SshHost name
// (see ssh-hosts.ts). Unknown refs are skipped. iPhone entries
// require at least one of tailscaleHost / pushcutName.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import { normalizeInputQuery } from '../input/query-match.js';
import { listSshHosts, type SshHost } from '../ssh/ssh-hosts.js';
import { migrateLegacyHomeFile } from '../storage/legacy-elanous-dir-migrate.js';

export type TransferTarget =
  | {
      kind: 'ssh';
      name: string;
      host: SshHost;
      remoteDir: string;
    }
  | {
      kind: 'iphone';
      name: string;
      /** Tailscale MagicDNS hostname or IP — used by `tailscale file cp`. */
      tailscaleHost?: string;
      /** Pushcut notification name used by the HTTP-serve fallback. */
      pushcutName?: string;
    };

export interface TransferTargetsFileV1 {
  version?: 1;
  targets?: unknown;
}

let configPathOverride: string | null = null;
let cachedTargets: TransferTarget[] | null = null;

// FU2 Tier 2 (PLAN-config-unification-elanous-root-2026-05-10 closing follow-up):
//   moved from ~/.config/monad-agent/transfer-targets.json → ~/.elanous/transfer-targets.json.
function defaultConfigPath(): string {
  const xdg = process.env['XDG_CONFIG_HOME']?.trim();
  if (xdg) return joinPath(xdg, 'monad-agent', 'transfer-targets.json');
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'transfer-targets.json'),
    elanousRel: 'transfer-targets.json',
  });
  return joinPath(homedir(), '.elanous', 'transfer-targets.json');
}

function configPath(): string {
  return configPathOverride ?? defaultConfigPath();
}

export function setTransferTargetsPathForTesting(path: string | null): void {
  configPathOverride = path;
  cachedTargets = null;
}

export function _resetTransferTargetsForTesting(): void {
  configPathOverride = null;
  cachedTargets = null;
}

/** Default-derived target list: one SSH entry per registered host
 *  (→ ~/Downloads/) + one iPhone entry bound to Pushcut. */
function buildDefaults(): TransferTarget[] {
  const out: TransferTarget[] = [];
  for (const h of listSshHosts()) {
    out.push({
      kind: 'ssh',
      name: h.name,
      host: h,
      remoteDir: '~/Downloads/',
    });
  }
  out.push({
    kind: 'iphone',
    name: 'iPhone',
    pushcutName: 'elanous-file-received',
  });
  return out;
}

function parseFileContent(raw: string): TransferTarget[] | null {
  try {
    const parsed = JSON.parse(raw) as TransferTargetsFileV1;
    if (!Array.isArray(parsed.targets)) return null;
    const hostByName = new Map(listSshHosts().map(h => [h.name.toLowerCase(), h]));
    const out: TransferTarget[] = [];
    for (const e of parsed.targets) {
      if (!e || typeof e !== 'object') continue;
      const rec = e as Record<string, unknown>;
      const kind = typeof rec.kind === 'string' ? rec.kind : '';
      const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '';
      if (!name) continue;
      if (kind === 'ssh') {
        const hostName = typeof rec.host === 'string' ? rec.host.trim() : '';
        const host = hostByName.get(hostName.toLowerCase());
        if (!host) continue;
        const remoteDir = typeof rec.remoteDir === 'string' && rec.remoteDir.trim()
          ? rec.remoteDir.trim()
          : '~/Downloads/';
        out.push({ kind: 'ssh', name, host, remoteDir });
      } else if (kind === 'iphone') {
        const tailscaleHost = typeof rec.tailscaleHost === 'string' && rec.tailscaleHost.trim()
          ? rec.tailscaleHost.trim()
          : undefined;
        const pushcutName = typeof rec.pushcutName === 'string' && rec.pushcutName.trim()
          ? rec.pushcutName.trim()
          : undefined;
        if (!tailscaleHost && !pushcutName) continue;
        out.push({ kind: 'iphone', name, tailscaleHost, pushcutName });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** List configured transfer targets. Overrides from JSON win; on
 *  any failure we fall back to buildDefaults(). Results are memoized
 *  per session. */
export function listTransferTargets(): TransferTarget[] {
  if (cachedTargets) return cachedTargets.slice();
  const path = configPath();
  if (!existsSync(path)) {
    cachedTargets = buildDefaults();
    return cachedTargets.slice();
  }
  try {
    const body = readFileSync(path, 'utf-8');
    const parsed = parseFileContent(body);
    if (parsed && parsed.length > 0) {
      cachedTargets = parsed;
      return cachedTargets.slice();
    }
  } catch { /* fall through */ }
  cachedTargets = buildDefaults();
  return cachedTargets.slice();
}

export function findTransferTarget(name: string): TransferTarget | null {
  const needle = normalizeInputQuery(name);
  return listTransferTargets().find(t => t.name.toLowerCase() === needle) ?? null;
}
