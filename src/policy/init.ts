// H6 P3 Bundle 1 · Policy router bootstrap.
//
// One call from dashboard.ts startup wires the router singleton with
// the live UsageStore + OverrideStore and sets the `hasLocalLLM`
// probe so rules know whether to treat local-llm as a real
// candidate. H6 P2 will replace the probe with the local-llm
// manager's availability signal.

import { debug } from '../debug/log.js';
import { getPolicyRouter, _setPolicyRouterForTesting, PolicyRouter } from './router.js';
import { getOverrideStore } from './override-store.js';
import { getUsageStore } from '../budget/usage-store.js';

export interface InitPolicyRouterOpts {
  /** H6 P2 가 land 되면 이 probe 가 실제 local-llm 가용성 반환. v1
   *  은 항상 `false` · local-llm 은 candidate 에 포함되지만
   *  `not-yet-implemented` 라벨로 toLaunchSpec 가 throw. */
  readonly hasLocalLLM?: () => boolean;
}

export interface PolicyRouterBootstrapResult {
  readonly router: PolicyRouter;
}

export function initPolicyRouter(
  opts: InitPolicyRouterOpts = {},
): PolicyRouterBootstrapResult {
  const hasLocalLLM = opts.hasLocalLLM ?? (() => false);
  const router = new PolicyRouter({
    usageStore: getUsageStore(),
    overrideStore: getOverrideStore(),
    hasLocalLLM,
  });
  _setPolicyRouterForTesting(router);
  if (debug.enabled) {
    debug.log('policy.init.done', 'ready', { hasLocalLLM: hasLocalLLM() });
  }
  return { router };
}

export { getPolicyRouter };
