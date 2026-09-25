// RFC #2161 Phase 6 FU — local LLM host (lm-studio / vllm / ollama)
// discovery sources.
//
// Reuses the existing `src/nexus/api/llm-hosts.ts` dispatcher
// (`fetchAllHosts`) so multi-host fan-out + per-host failure isolation
// + auth + timeout handling stay in one place. The discovery source
// just *picks* the subset of configured hosts to scan and maps the
// `LlmHostFetchResult[]` payload into `DiscoveredModel[]` with provider
// `'local'`.
//
// The host config is read via `getEffectiveHosts()` (reads
// MONAD_LLM_HOSTS env + in-memory override). When no matching hosts
// are configured, the source returns ok=true with models=[] so the
// runner doesn't surface a misleading "missing-api-key" style error
// (local hosts opt in by being declared, not by env presence).

import {
  fetchAllHosts,
  getEffectiveHosts,
  type LlmHostConfig,
  type LlmHostKind,
} from '../../../nexus/api/llm-hosts.js';
import type {
  DiscoveredModel,
  DiscoverySource,
  DiscoverySourceId,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

/** Build a discovery source that scans every configured host of the
 *  given `kind` (or kinds). All hits are surfaced as provider=`'local'`
 *  with `discoveryMeta.source` reflecting which host kind found them. */
function makeLocalHostSource(
  sourceId: DiscoverySourceId,
  acceptKind: (k: LlmHostKind) => boolean,
  metaSource: DiscoveredModel['discoveryMeta']['source'],
): DiscoverySource {
  return {
    id: sourceId,
    async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
      const now = opts.now ?? Date.now;
      const startedAt = now();
      const eff = getEffectiveHosts();
      const hosts: LlmHostConfig[] = eff.hosts.filter((h) => acceptKind(h.kind));
      if (hosts.length === 0) {
        return {
          source: sourceId,
          ok: true,
          models: [],
          durationMs: now() - startedAt,
        };
      }
      const results = await fetchAllHosts(hosts, {
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
      const lastSeen = new Date(now()).toISOString();
      const models: DiscoveredModel[] = [];
      let anyError: string | undefined;
      let anyOk = false;
      for (const r of results) {
        if (r.error) {
          // Surface the first error so a debugger has a hint, but
          // don't fail the source — partial success is fine for
          // multi-host fan-out (one Mac mini down doesn't break the
          // dropdown).
          anyError = anyError ?? `${r.host}: ${r.error}`;
        } else {
          anyOk = true;
        }
        for (const m of r.models) {
          models.push({
            id: m.id,
            provider: 'local',
            partial: {
              id: m.id,
              provider: 'local',
              displayName: m.id,
              ...(m.ownedBy ? { family: m.ownedBy } : {}),
            },
            discoveryMeta: {
              source: metaSource,
              lastSeen,
              autoFilled: true,
              confidence: 'medium', // local hosts ship many fine-tunes · ids alone aren't strong
            },
          });
        }
      }
      // Hosts configured + every one failed → ok=false so the snapshot
      // surfaces the issue. Partial success → ok=true with the partial
      // error string informational.
      const ok = anyOk || anyError === undefined;
      const result: DiscoverySourceResult = {
        source: sourceId,
        ok,
        models,
        durationMs: now() - startedAt,
      };
      if (anyError !== undefined && (!ok || models.length === 0)) {
        result.error = anyError;
      }
      return result;
    },
  };
}

/** lm-studio / vllm — every host with an OpenAI-compat surface. */
export const lmStudioSource: DiscoverySource = makeLocalHostSource(
  'lmstudio',
  (k) => k === 'lm-studio' || k === 'vllm',
  'auto-local-host',
);

/** Ollama — every host with kind 'ollama'. */
export const ollamaSource: DiscoverySource = makeLocalHostSource(
  'ollama',
  (k) => k === 'ollama',
  'auto-local-host',
);
