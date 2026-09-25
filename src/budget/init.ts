// H6 P1 · Bundle 2 bootstrap.
//
// One call from dashboard.ts startup wires the four fetchers into
// the module-level `UsageStore` singleton and (optionally) runs one
// refresh in the background so the LLM tools return real data on
// the very first invocation.
//
// No refresh timer here · a timer would make tests flaky and
// duplicate the lazy `refresh=true` semantics BudgetStatus already
// exposes. Bundle 3+ can add an opt-in timer behind an env flag.

import { debug } from '../debug/log.js';
import { createClaudeFetcher } from './fetchers/claude.js';
import { createCodexFetcher } from './fetchers/codex.js';
import { createGeminiFetcher } from './fetchers/gemini.js';
import { createGrokFetcher } from './fetchers/grok.js';
import { createLocalLLMFetcher } from './fetchers/local-llm.js';
import type { UsageProvider } from './types.js';
import { getUsageStore, type UsageStore } from './usage-store.js';

export interface InitBudgetStoreOpts {
  /** Run one refresh call after registering fetchers. Default false —
   *  callers that need fresh data on boot should call
   *  `BudgetStatus({refresh:true})` explicitly. */
  readonly eagerRefresh?: boolean;
  /** Test seam · inject a pre-built store. */
  readonly store?: UsageStore;
}

export interface BudgetBootstrapResult {
  readonly store: UsageStore;
  readonly providers: readonly UsageProvider[];
}

export function initBudgetStore(
  opts: InitBudgetStoreOpts = {},
): BudgetBootstrapResult {
  const store = opts.store ?? getUsageStore();
  store.registerFetcher('codex', createCodexFetcher());
  store.registerFetcher('claude', createClaudeFetcher());
  store.registerFetcher('gemini', createGeminiFetcher());
  store.registerFetcher('local-llm', createLocalLLMFetcher());
  store.registerFetcher('grok', createGrokFetcher());
  if (opts.eagerRefresh) {
    // Fire and forget · errors surface via store.getError() + failure gate.
    void store.refresh().catch((err) => {
      if (debug.enabled) {
        debug.log('budget.init.eager-refresh-fail', 'boot', {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    });
  }
  if (debug.enabled) {
    debug.log('budget.init.done', 'registered', {
      providers: store.listProviders(),
    });
  }
  return {
    store,
    providers: store.listProviders(),
  };
}
