// H6 P2 Bundle 1 · Local LLM node registry.
//
// Per PLAN §5 D13 — reuses `src/ssh/ssh-hosts.ts` for Tailscale fleet
// discovery so the set of nodes stays in sync with the user's SSH
// picker. The elanous host itself is prepended as the `'local'` pseudo-
// node so single-host users don't need to touch SSH config.
//
// Node runtime status (reachable + which runtimes installed) lives
// in a small in-process cache populated by `lmstudio-probe.ts`; this
// module just holds the topology.
//
// Fleet fixups 2026-04-22 · self-alias filtering:
//   On a Tailscale fleet it's common for the SSH host list to include
//   the local machine's own magic-DNS name (e.g. `mbp` resolves to
//   the local tun IP `100.64.0.2` for the user on elanous). SSH-ing
//   to self loops back to port 22 which typically rejects with
//   `Permission denied (publickey,password,keyboard-interactive)`
//   because the user doesn't maintain a self-login keyring. The probe
//   reports that host as offline forever — pure noise.
//
//   `initializeSelfAliases()` resolves each SSH host name once at
//   startup, compares against this machine's IPv4 interfaces, and
//   populates a filter set. `listNodes()` then drops any SSH host
//   that aliases this machine. The `'local'` pseudo-node still
//   represents the elanous host, so no functionality is lost.

import * as os from 'node:os';
import { promises as dns } from 'node:dns';
import { listSshHosts, type SshHost } from '../../ssh/ssh-hosts.js';
import type { LlmNode, LlmRuntime } from './types.js';

/** In-process per-node status cache · updated by probes. */
interface NodeStatus {
  lastProbedAt: number;
  reachable: boolean | undefined;
  runtimes: LlmRuntime[];
  lmstudioBaseUrl?: string;
  /** Bundle 2 C1 · populated by `probeOllama`. Independent of
   *  `lmstudioBaseUrl` — a node may have both probed simultaneously. */
  ollamaBaseUrl?: string;
  /** Bundle 2 C2 · populated by `probeMlx` when `mlx_lm.server` is
   *  reachable. */
  mlxBaseUrl?: string;
  /** Bundle 2 C3 · populated by `probeDocker` when a running LLM
   *  container (image name matches filter) is found with a published
   *  port. v1 holds the first matched container per node (D32). */
  dockerBaseUrl?: string;
}

const status = new Map<string, NodeStatus>();

/** Lowercased ssh-host `name` values known to alias this machine.
 *  Populated lazily by `initializeSelfAliases()` · `null` means "not
 *  yet computed" (everything is included). */
let selfAliases: Set<string> | null = null;
let selfAliasInit: Promise<void> | null = null;

function blankStatus(): NodeStatus {
  return { lastProbedAt: 0, reachable: undefined, runtimes: [] };
}

/** Snapshot of the current topology · each node carries its cached
 *  probe status (or blanks before the first probe).
 *
 *  Call order guaranteed:
 *    1. `'local'` pseudo-node first (elanous host).
 *    2. SSH fleet in `ssh-hosts.ts` order (mba · node-b · mbp · minio · node-c
 *       by default; user config override preserved).
 *
 *  Self-alias filtering (fleet fixups 2026-04-22): if
 *  `initializeSelfAliases()` has populated the self-alias set, any
 *  ssh-host whose name is in that set is skipped — it aliases the
 *  `'local'` pseudo-node. Before the first `initializeSelfAliases`
 *  call the filter is inert (all hosts included) so tests and
 *  bootstrap paths that haven't awaited init still see the full
 *  fleet.
 */
export function listNodes(): LlmNode[] {
  const out: LlmNode[] = [];
  out.push(buildNode({ id: 'local', label: 'local', isLocal: true, description: 'elanous host' }));
  for (const h of listSshHosts()) {
    if (selfAliases?.has(h.name.toLowerCase())) continue;
    out.push(buildNode({
      id: h.name,
      label: h.name,
      isLocal: false,
      sshHost: h.host,
      ...(h.user ? { sshUser: h.user } : {}),
      ...(h.description ? { description: h.description } : {}),
    }));
  }
  return out;
}

/** Look up a single node · returns null when unknown. Case-insensitive. */
export function findNode(id: string): LlmNode | null {
  const needle = id.trim().toLowerCase();
  return listNodes().find((n) => n.id.toLowerCase() === needle) ?? null;
}

interface NodeSeed {
  id: string;
  label: string;
  isLocal: boolean;
  sshHost?: string;
  sshUser?: string;
  description?: string;
}

function buildNode(seed: NodeSeed): LlmNode {
  const s = status.get(seed.id) ?? blankStatus();
  const node: LlmNode = {
    id: seed.id,
    label: seed.label,
    isLocal: seed.isLocal,
    ...(seed.sshHost ? { sshHost: seed.sshHost } : {}),
    ...(seed.sshUser ? { sshUser: seed.sshUser } : {}),
    ...(seed.description ? { description: seed.description } : {}),
    lastProbedAt: s.lastProbedAt,
    ...(s.reachable !== undefined ? { reachable: s.reachable } : {}),
    runtimes: [...s.runtimes],
    ...(s.lmstudioBaseUrl ? { lmstudioBaseUrl: s.lmstudioBaseUrl } : {}),
    ...(s.ollamaBaseUrl ? { ollamaBaseUrl: s.ollamaBaseUrl } : {}),
    ...(s.mlxBaseUrl ? { mlxBaseUrl: s.mlxBaseUrl } : {}),
    ...(s.dockerBaseUrl ? { dockerBaseUrl: s.dockerBaseUrl } : {}),
  };
  return node;
}

/** Merge probe output into the node status cache. Called by the
 *  probe module · tests can also call this directly to stage state.
 *
 *  Semantics: last-write-wins for each provided field; fields not
 *  provided in `update` keep their previous values. In Bundle 2 C1
 *  the dual-probe flow writes per-probe slices (lmstudio-probe sets
 *  runtimes=['lmstudio'] on success, ollama-probe sets runtimes=
 *  ['ollama']) · after both probes complete, manager.refreshInventory
 *  writes a final aggregated slice (union runtimes + OR-reachable +
 *  both baseUrls) so the transient intermediate state converges to
 *  the correct per-node summary. */
export function updateNodeStatus(
  nodeId: string,
  update: {
    reachable?: boolean;
    runtimes?: readonly LlmRuntime[];
    lmstudioBaseUrl?: string;
    ollamaBaseUrl?: string;
    mlxBaseUrl?: string;
    dockerBaseUrl?: string;
    at?: number;
  },
): void {
  const prev = status.get(nodeId) ?? blankStatus();
  const next: NodeStatus = {
    lastProbedAt: update.at ?? Date.now(),
    reachable: update.reachable ?? prev.reachable,
    runtimes: update.runtimes ? [...update.runtimes] : prev.runtimes,
    ...(update.lmstudioBaseUrl !== undefined
      ? { lmstudioBaseUrl: update.lmstudioBaseUrl }
      : prev.lmstudioBaseUrl !== undefined
        ? { lmstudioBaseUrl: prev.lmstudioBaseUrl }
        : {}),
    ...(update.ollamaBaseUrl !== undefined
      ? { ollamaBaseUrl: update.ollamaBaseUrl }
      : prev.ollamaBaseUrl !== undefined
        ? { ollamaBaseUrl: prev.ollamaBaseUrl }
        : {}),
    ...(update.mlxBaseUrl !== undefined
      ? { mlxBaseUrl: update.mlxBaseUrl }
      : prev.mlxBaseUrl !== undefined
        ? { mlxBaseUrl: prev.mlxBaseUrl }
        : {}),
    ...(update.dockerBaseUrl !== undefined
      ? { dockerBaseUrl: update.dockerBaseUrl }
      : prev.dockerBaseUrl !== undefined
        ? { dockerBaseUrl: prev.dockerBaseUrl }
        : {}),
  };
  status.set(nodeId, next);
}

/** Test-only snapshot for assertions. */
export function _getNodeStatusForTesting(nodeId: string): NodeStatus | undefined {
  const s = status.get(nodeId);
  return s ? { ...s, runtimes: [...s.runtimes] } : undefined;
}

/** Clear the status cache · test isolation.
 *
 *  Fleet fixups 2026-04-22 · also pins the self-alias set to an
 *  empty resolved state so downstream `initializeSelfAliases()` calls
 *  short-circuit without touching real DNS / network interfaces.
 *  Tests that want to exercise the self-alias logic must first call
 *  `_unlockSelfAliasesForTesting()` and then `initializeSelfAliases`
 *  with their injected deps. */
export function _resetNodeStatusForTesting(): void {
  status.clear();
  selfAliases = new Set();
  selfAliasInit = Promise.resolve();
}

/** Release the test-only pinned self-alias state so tests can inject
 *  their own resolution through `initializeSelfAliases()`. Pair with
 *  a prior `_resetNodeStatusForTesting()` to start clean. */
export function _unlockSelfAliasesForTesting(): void {
  selfAliases = null;
  selfAliasInit = null;
}

// ─── Self-alias detection (fleet fixups 2026-04-22) ────────────────

/** Injectable deps for `initializeSelfAliases`. Production defaults
 *  read `os.networkInterfaces()` + `dns.lookup()`; tests pass canned
 *  values to stay deterministic and fast. */
export interface SelfAliasDeps {
  /** Override for this machine's non-internal IPv4 addresses. */
  readonly localIps?: readonly string[];
  /** Override for DNS resolution per host · returns null on failure
   *  (matches production behavior). */
  readonly resolveHost?: (host: string) => Promise<string | null>;
}

/** Populate the self-alias filter · idempotent. First call resolves
 *  each configured SSH host; any host whose resolved IPv4 address
 *  matches one of this machine's interfaces is marked as self and
 *  dropped from `listNodes()`. Subsequent calls reuse the same
 *  Promise so concurrent callers wait on a single pass. */
export async function initializeSelfAliases(deps: SelfAliasDeps = {}): Promise<void> {
  if (selfAliasInit) return selfAliasInit;
  selfAliasInit = (async () => {
    const localIps = new Set<string>(deps.localIps ?? defaultLocalIps());
    const resolve = deps.resolveHost ?? defaultResolveHost;
    const aliases = new Set<string>();
    for (const h of listSshHosts()) {
      const ip = await resolve(h.host);
      if (ip && localIps.has(ip)) aliases.add(h.name.toLowerCase());
    }
    selfAliases = aliases;
  })();
  return selfAliasInit;
}

/** Current self-alias snapshot · `null` before initialization. */
export function _peekSelfAliasesForTesting(): readonly string[] | null {
  return selfAliases ? [...selfAliases].sort() : null;
}

function defaultLocalIps(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      // IPv4 only for v1 · non-internal (skip 127.0.0.1 / ::1).
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

async function defaultResolveHost(host: string): Promise<string | null> {
  try {
    const { address } = await dns.lookup(host, { family: 4 });
    return address;
  } catch {
    return null;
  }
}

/** Convenience re-export for call-sites that only need SSH details. */
export type { SshHost };
