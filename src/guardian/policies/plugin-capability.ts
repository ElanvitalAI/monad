// Arc B — plugin-capability policy adapter.
//
// Wraps `src/plugins/core/capability-policy.ts` (`PluginCapabilityPolicy`)
// so guardian.check() can evaluate the same decision the plugin-host
// already uses, from the single dispatch seam. The underlying class
// is imported — not moved — so plugin-host's existing `assertCapability`
// calls stay intact. Guardian is an *additional* consumer.
//
// When ctx.plugin is undefined (native tool path), the adapter
// short-circuits to `allow` — native tool defaults land in the
// `mutating-default` forward-compat slot (PLAN §2 Scope-cut).

import { PluginCapabilityPolicy } from '../../plugins/core/capability-policy.js';
import type { CapabilityPolicyContext } from '../../plugins/core/capability-policy.js';
import type { GuardianContext, GuardianVerdict } from '../types.js';

const policy = new PluginCapabilityPolicy();

interface Spec { require: 'read' | 'write' | 'network' | 'process' | 'clipboard' }

export function checkPluginCapability(spec: Spec, ctx: GuardianContext): GuardianVerdict {
  // No plugin context → this policy doesn't apply. Native tools
  // bypass plugin-scoped checks; the mutating-default slot is the
  // intended entry point for them (forward-compat).
  if (!ctx.plugin) {
    return { decision: 'allow', reasons: [] };
  }

  const policyCtx: CapabilityPolicyContext = {
    pluginId: ctx.plugin.pluginId,
    source: ctx.plugin.source,
    capabilities: ctx.plugin.capabilities,
    workspaceTrusted: ctx.plugin.workspaceTrusted,
    userTrusted: ctx.plugin.userTrusted,
  };

  const path = stringArg(ctx.argsSummary, 'path') ?? stringArg(ctx.argsSummary, 'file_path') ?? '';
  const url = stringArg(ctx.argsSummary, 'url') ?? '';

  const decision = (() => {
    switch (spec.require) {
      case 'read':      return policy.canReadFile(policyCtx, path);
      case 'write':     return policy.canWriteFile(policyCtx, path);
      case 'network':   return policy.canNetwork(policyCtx, url);
      case 'clipboard': return policy.canClipboard(policyCtx, clipboardMode(ctx));
      case 'process':   return { ok: false, reason: 'process spec must be checked with the execution surface (skipped in adapter)' };
    }
  })();

  if (decision.ok) return { decision: 'allow', reasons: [] };
  return {
    decision: 'deny',
    reasons: [decision.reason],
    auditPayload: { require: spec.require, path, url },
  };
}

function stringArg(summary: Record<string, unknown> | undefined, key: string): string | null {
  const v = summary?.[key];
  return typeof v === 'string' ? v : null;
}

function clipboardMode(ctx: GuardianContext): 'read' | 'write' {
  const v = ctx.argsSummary?.['mode'];
  return v === 'write' ? 'write' : 'read';
}
