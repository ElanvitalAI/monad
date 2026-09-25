// H6 P1 Bundle 2 · Local-LLM fetcher (stub).
//
// Bundle 2 ships a placeholder fetcher so the UsageStore + LLM tools
// can include `local-llm` in every output without crashing. The real
// fetcher (H6 P2 · multi-machine fleet inventory, model discovery,
// throughput sampling) is a separate arc — the budget side just
// needs to know local LLMs are "always available, no monetary cost".
//
// Snapshot contract: a single `session` window with 0% used and
// `Infinity` limit. PLAN §5 D7: local-llm is free + capacity-only.
// LLM tool output should render this as "unlimited" rather than 0%.

import type { ProviderFetcher } from '../usage-store.js';
import type { RateWindow, UsageProvider, UsageSnapshot } from '../types.js';

export interface LocalLLMFetcherOpts {
  readonly now?: () => number;
}

export function createLocalLLMFetcher(opts: LocalLLMFetcherOpts = {}): ProviderFetcher {
  return {
    async fetch(): Promise<UsageSnapshot> {
      const now = (opts.now ?? Date.now)();
      const window: RateWindow = {
        kind: 'session',
        windowMinutes: 24 * 60,
        limit: Number.POSITIVE_INFINITY,
        used: 0,
        remainingPercent: 100,
        resetsAt: 0,
      };
      return {
        provider: 'local-llm' as UsageProvider,
        windows: [window],
        plan: 'free',
        fetchedAt: now,
        source: 'local-log',
      };
    },
  };
}
