// H6 P2 Bundle 1 · Local LLM Manager · read-only public API.
//
// Thin facade over node-registry + lmstudio-probe. Bundle 1 exposes
// only the read surface needed for:
//   - `/llm nodes` · `/llm models` slash + LLM tools (inventory)
//   - `src/llm.ts::LocalProvider` multi-node routing via
//     `resolveBaseUrl(nodeId, modelId)`
//
// Install/boot/Intel live in Bundle 2 (§3.A installer/booter · §3.C
// Intel) · this module must never import them to keep the Bundle 1
// dependency graph minimal.
//
// Design rails (PLAN §3.0, §5):
//   - D9  Inventory staleness 5 min · refresh 명시 호출 시 invalidate
//   - D11 Bundle 1 = read-only · install/boot 없음
//   - D13 node-registry 는 ssh-hosts 재사용 (별도 registry 없음)

import { debug } from '../../debug/log.js';
import {
  listNodes,
  findNode,
  updateNodeStatus,
  initializeSelfAliases,
  _resetNodeStatusForTesting,
  type SelfAliasDeps,
} from './node-registry.js';
import { probeLmstudio, type ProbeDeps } from './lmstudio-probe.js';
import { probeOllama, type OllamaProbeDeps } from './ollama-probe.js';
import { probeMlx, type MlxProbeDeps } from './mlx-probe.js';
import { probeDocker, type DockerProbeDeps } from './docker-probe.js';
import type {
  LlmInventory,
  LlmModel,
  LlmNode,
  LlmProbeResult,
  LlmRuntime,
} from './types.js';
import { INVENTORY_STALENESS_MS } from './types.js';

// Bundle 2 C1 · dual-probe (lmstudio + ollama) ProbeDeps share the
// same shape. Bundle 2 C2+C3 extends to quad-probe — MlxProbeDeps and
// DockerProbeDeps also share (runLocal / runRemote / now / timeoutMs)
// so the intersection collapses to the same 4 fields, and test callers
// can inject a single fake runner that dispatches on `argv[0]`
// (`lms` / `curl` / `docker`) to simulate all four probes at once.
// Fleet fixups 2026-04-22 · `SelfAliasDeps` rolls in the
// `localIps` / `resolveHost` overrides used by `initializeSelfAliases`.
export interface ManagerDeps
  extends ProbeDeps, OllamaProbeDeps, MlxProbeDeps, DockerProbeDeps, SelfAliasDeps {
  /** Staleness window · default 5 min (D9). */
  readonly staleMs?: number;
}

interface CachedInventory {
  at: number;
  nodes: LlmNode[];
  models: LlmModel[];
  warnings: string[];
}

let cached: CachedInventory | null = null;

/** Return the current inventory snapshot. If the cache is within the
 *  staleness window (`staleMs`), it's returned as-is (`cached:true`);
 *  otherwise a fresh probe runs against every node in parallel.
 *
 *  Bundle 1 probes LM Studio only — detecting Ollama/MLX/Docker is
 *  Bundle 2.
 */
export async function getInventory(deps: ManagerDeps = {}): Promise<LlmInventory> {
  const now = deps.now ?? Date.now;
  const stale = deps.staleMs ?? INVENTORY_STALENESS_MS;
  if (cached && now() - cached.at < stale) {
    return {
      nodes: [...cached.nodes],
      models: [...cached.models],
      at: cached.at,
      cached: true,
      warnings: [...cached.warnings],
    };
  }
  return refreshInventory(deps);
}

/** Force a fresh probe across every node. Always updates the cache.
 *
 *  Bundle 2 C2+C3 · quad-probe orchestration: for each node,
 *  probeLmstudio · probeOllama · probeMlx · probeDocker run in
 *  parallel. Each probe mutates the node status cache independently
 *  (writes its own runtimes slice + baseUrl). After all four complete,
 *  this orchestrator writes a final aggregated slice per node (union
 *  runtimes + OR-reachable) so the transient "overwrite" during
 *  parallel writes converges to the correct summary before any caller
 *  reads listNodes(). Bundle 2 C1 established the 2-probe pattern;
 *  C2+C3 extends it to 4 without changing the convergence rule. */
export async function refreshInventory(deps: ManagerDeps = {}): Promise<LlmInventory> {
  const now = deps.now ?? Date.now;
  const at = now();
  // Populate self-alias filter before walking the fleet so SSH hosts
  // that resolve to this machine's own IPs (e.g. Tailscale magic-DNS
  // for the local node) are dropped. Idempotent — concurrent / repeat
  // calls share the same Promise.
  await initializeSelfAliases(deps);
  const targets = listNodes();

  // Per-node quad probe · parallel within each node, parallel across
  // nodes. Results come back grouped so we can compute the merged
  // summary without re-reading the status cache (which may have been
  // clobbered by whichever probe wrote last).
  const pairs = await Promise.all(
    targets.map(async (n) => {
      const nodeSeed = {
        id: n.id,
        isLocal: n.isLocal,
        ...(n.sshHost ? { sshHost: n.sshHost } : {}),
        ...(n.sshUser ? { sshUser: n.sshUser } : {}),
      };
      const [lms, oll, mlx, docker] = await Promise.all([
        probeLmstudio(nodeSeed, deps),
        probeOllama(nodeSeed, deps),
        probeMlx(nodeSeed, deps),
        probeDocker(nodeSeed, deps),
      ]);
      return { node: n, lms, oll, mlx, docker };
    }),
  );

  const warnings: string[] = [];
  const models: LlmModel[] = [];
  for (const { node, lms, oll, mlx, docker } of pairs) {
    for (const w of lms.warnings) warnings.push(`${node.id}:lmstudio:${w}`);
    for (const w of oll.warnings) warnings.push(`${node.id}:ollama:${w}`);
    for (const w of mlx.warnings) warnings.push(`${node.id}:mlx:${w}`);
    for (const w of docker.warnings) warnings.push(`${node.id}:docker:${w}`);
    for (const m of lms.models) models.push(m);
    for (const m of oll.models) models.push(m);
    for (const m of mlx.models) models.push(m);
    for (const m of docker.models) models.push(m);

    // Final aggregated write · convergence point. The runtimes union
    // re-populates whichever runtime got overwritten by the later
    // parallel write; `reachable` becomes true if ANY probe succeeded.
    const runtimes: LlmRuntime[] = [];
    if (lms.reachable) runtimes.push('lmstudio');
    if (oll.reachable) runtimes.push('ollama');
    if (mlx.reachable) runtimes.push('mlx');
    if (docker.reachable) runtimes.push('docker');
    const aggregated: Parameters<typeof updateNodeStatus>[1] = {
      reachable: lms.reachable || oll.reachable || mlx.reachable || docker.reachable,
      runtimes,
      at,
    };
    // Keep each baseUrl independent · probes already wrote them on
    // success, and updateNodeStatus preserves-on-undefined, so no
    // explicit carry-forward needed here unless we want to explicitly
    // clear unreachable ones (v1 leaves them so URLs stay visible
    // even if the current probe blipped).
    updateNodeStatus(node.id, aggregated);
  }

  // Re-read nodes AFTER the final aggregated write so listNodes()
  // returns the converged runtimes union.
  const nodes = listNodes();
  models.sort((a, b) => {
    if (a.nodeId !== b.nodeId) return a.nodeId.localeCompare(b.nodeId);
    return a.label.localeCompare(b.label);
  });

  cached = { at, nodes: [...nodes], models: [...models], warnings: [...warnings] };

  // 4.2 elevation (2026-04-22) · always-on file trail. refreshInventory
  // fires on user-driven `/llm refresh` or first lazy probe — orders of
  // magnitude rarer than keystroke / render. The four-int summary
  // payload is microscopic, and it's the single trace that ties
  // together every per-runtime probe outcome for fleet-bug triage.
  debug.log('llm.manager.refresh', '', {
    nodes: nodes.length,
    models: models.length,
    reachable: nodes.filter((n) => n.reachable).length,
    warnings: warnings.length,
  });

  return {
    nodes: [...nodes],
    models: [...models],
    at,
    cached: false,
    warnings: [...warnings],
  };
}

/** Snapshot of nodes only (topology + cached status, no probe). */
export function listKnownNodes(): LlmNode[] {
  return listNodes();
}

/** Models on a specific node from the current cache. Returns `[]`
 *  until the first `getInventory()` / `refreshInventory()` call. */
export function listModelsFor(nodeId: string): LlmModel[] {
  if (!cached) return [];
  return cached.models.filter((m) => m.nodeId === nodeId);
}

/** All models across nodes from cache · same semantics as `listModelsFor`. */
export function listAllModels(): LlmModel[] {
  if (!cached) return [];
  return [...cached.models];
}

/** Resolve the OpenAI-compat base URL for a given node + model id.
 *  Bundle 2 C2+C3 · runtime-aware across 4 runtimes (lmstudio · ollama
 *  · mlx · docker): looks up the cached `LlmModel.runtime` for this
 *  modelId and returns the matching per-runtime baseUrl. Falls back
 *  to lmstudioBaseUrl when the model isn't in the cache, so pre-probe
 *  callers (e.g. outer-LLM routing before /llm refresh) still work
 *  for LM Studio — matching Bundle 1 behavior. Returns `null` when
 *  the node is unknown / unreachable / has no matching baseUrl
 *  cached. */
export function resolveBaseUrl(nodeId: string, modelId: string): string | null {
  const node = findNode(nodeId);
  if (!node) return null;
  if (!node.reachable) return null;
  // Walk the cached models (if any) to find the runtime hosting modelId.
  const hosted = cached?.models.find(
    (m) => m.nodeId === nodeId && m.id === modelId,
  );
  if (hosted?.runtime === 'ollama') return node.ollamaBaseUrl ?? null;
  if (hosted?.runtime === 'mlx') return node.mlxBaseUrl ?? null;
  if (hosted?.runtime === 'docker') return node.dockerBaseUrl ?? null;
  if (hosted?.runtime === 'lmstudio') return node.lmstudioBaseUrl ?? null;
  // Unknown model (pre-probe) · prefer LM Studio for Bundle 1 compat,
  // fall through to the other runtimes if LM Studio is absent.
  return (
    node.lmstudioBaseUrl
    ?? node.ollamaBaseUrl
    ?? node.mlxBaseUrl
    ?? node.dockerBaseUrl
    ?? null
  );
}

/** Reset cache · test isolation. Also clears node-registry status. */
export function _resetManagerForTesting(): void {
  cached = null;
  _resetNodeStatusForTesting();
}

/** Expose the last probe results for debugging · not a public API. */
export function _peekCacheForTesting(): CachedInventory | null {
  return cached ? { ...cached } : null;
}

/** Re-export for convenience (call-sites that want raw probe data). */
export type { LlmProbeResult };
