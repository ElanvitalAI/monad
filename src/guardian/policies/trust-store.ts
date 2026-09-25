// Arc B — trust-store policy adapter.
//
// Wraps `src/plugins/core/trust-store.ts` (`PluginTrustStore`) so the
// single guardian.check() seam can deny untrusted plugin dispatches.
// The store is re-used as-is (no file moves, no semantics change).

import { PluginTrustStore, type PluginTrustScope } from '../../plugins/core/trust-store.js';
import type { GuardianContext, GuardianVerdict } from '../types.js';

const store = new PluginTrustStore();

export function checkTrustStore(ctx: GuardianContext): GuardianVerdict {
  if (!ctx.plugin) {
    return { decision: 'allow', reasons: [] };
  }

  // Builtin plugins bypass the trust store by convention — they ship
  // with the binary and the user has already trusted the binary.
  if (ctx.plugin.source === 'builtin') {
    return { decision: 'allow', reasons: [] };
  }

  const scope: PluginTrustScope = ctx.plugin.source === 'user' ? 'user' : 'workspace';
  if (store.isTrusted(ctx.plugin.pluginId, scope)) {
    return { decision: 'allow', reasons: [] };
  }

  return {
    decision: 'deny',
    reasons: [`plugin "${ctx.plugin.pluginId}" is not trusted (scope: ${scope})`],
    auditPayload: { pluginId: ctx.plugin.pluginId, scope },
  };
}
