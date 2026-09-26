// MVP M2.4 — remote daemon target resolution.
//
// Shared by `elanous attach --host ...` (CLI flags) and the
// `monad-agent` default-dashboard `ELANOUS_REMOTE` env-var path. Maps
// (CLI opts + env vars + token-file path) → a normalized
// `{ url, token? }` ready for `connectWebSocketClient(...)`.
//
// Resolution rules (first match wins, see resolveRemoteTarget):
//   url:    --url > --host > ELANOUS_REMOTE
//   token:  --token > --token-file > ELANOUS_TOKEN > (none)
//   noAuth: --no-auth | ELANOUS_NO_AUTH=1
//
// `--host` accepts either `host:port` or `host` (defaults to no port).
// Bare strings are coerced to `ws://<value>/v1/acp` — full URLs
// (`ws://...` or `wss://...`) are passed through unchanged.

import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import { readFile } from 'node:fs/promises';

import { readDeprecatedEnv } from '../control-client/env-resolver.js';

export interface RemoteTarget {
  url: string;
  token?: string;
  label?: string;
}

export interface ResolveRemoteOpts {
  /** `host[:port]` form (auto-coerced to `ws://host[:port]/v1/acp`). */
  host?: string;
  /** Full URL form (`ws://...` or `wss://...`). Overrides `host`. */
  url?: string;
  /** Bearer token literal. Overrides token-file + env. */
  token?: string;
  /** Path to a file containing the token. Overrides env. */
  tokenFile?: string;
  /** Skip auth handshake (Tailscale-only mode). */
  noAuth?: boolean;
  /** Best-effort identification label sent in the handshake. */
  label?: string;
}

export const WS_ACP_PATH = '/v1/acp';

/** Expand a `host[:port]` or full URL into a `ws://` URL terminating
 *  in `/v1/acp`. Full URLs pass through verbatim. */
export function expandRemoteUrl(input: string): string {
  if (input.startsWith('ws://') || input.startsWith('wss://')) return input;
  // Bare host or host:port — assume ws:// + canonical path.
  return `ws://${input}${WS_ACP_PATH}`;
}

/** Resolve a remote daemon target from CLI opts + env vars. Returns
 *  `null` when no remote is requested (caller falls back to local
 *  unix socket).
 *
 *  Step 5 PR γ — env reads route through `readDeprecatedEnv` so a
 *  per-process deprecation warning fires once when a user still
 *  drives the dashboard / attach via env vars. The override
 *  precedence is unchanged (env still wins over the SDK fallback
 *  caller may also try). */
export async function resolveRemoteTarget(
  opts: ResolveRemoteOpts,
): Promise<RemoteTarget | null> {
  const envRemote = readDeprecatedEnv('ELANOUS_REMOTE').value ?? undefined;
  const envToken = readDeprecatedEnv('ELANOUS_TOKEN').value ?? undefined;
  const envNoAuth = process.env.ELANOUS_NO_AUTH === '1';

  const rawTarget = opts.url ?? opts.host ?? envRemote;
  if (!rawTarget || rawTarget.length === 0) return null;
  const url = expandRemoteUrl(rawTarget);

  const noAuth = opts.noAuth ?? envNoAuth;
  if (noAuth) {
    return {
      url,
      ...(opts.label ? { label: opts.label } : {}),
    };
  }

  let token = opts.token ?? envToken;
  if (!token && opts.tokenFile) {
    token = (await readFile(opts.tokenFile, 'utf8')).trim();
  }

  return {
    url,
    ...(token ? { token } : {}),
    ...(opts.label ? { label: opts.label } : {}),
  };
}

/** Convenience: default token-file path (`~/.elanous/acp-token`). */
export function defaultTokenFilePath(): string {
  return joinPath(homedir(), '.elanous', 'acp-token');
}
