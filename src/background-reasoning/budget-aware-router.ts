// Y2 budget-aware router · decide local / cloud / queue per background task.
// Cf. ROADMAP-background-reasoning §5.3 (a/b/c) + §5.4 budget yaml.

import type { BackgroundReasoningConfig } from './config.js';
import type { SlotRole } from './local-llm-process.js';

export type RouteDecision = 'local' | 'cloud' | 'queue';

export interface BudgetUsageProbe {
  /** Cloud spend so far this month in USD. */
  monthlyCloudUsd(): number;
}

export interface RouteCtx {
  role: SlotRole;
  /** Caller-side hint — local pool has a free slot right now. */
  localAvailable: boolean;
  /** Optional emergency override — bypasses budget when cfg allows. */
  emergency?: boolean;
}

export interface RouteResult {
  decision: RouteDecision;
  reason: string;
  /** Set when monthlyCloudUsd has crossed the warn ratio. */
  warn?: boolean;
}

export interface BudgetAwareRouterOpts {
  config: BackgroundReasoningConfig;
  probe: BudgetUsageProbe;
}

export class BudgetAwareRouter {
  private readonly config: BackgroundReasoningConfig;
  private readonly probe: BudgetUsageProbe;

  constructor(opts: BudgetAwareRouterOpts) {
    this.config = opts.config;
    this.probe = opts.probe;
  }

  route(ctx: RouteCtx): RouteResult {
    if (ctx.localAvailable) {
      return { decision: 'local', reason: 'local-slot-free' };
    }

    const cloudAllowedForRole =
      ctx.role === 'patcher' ? this.config.patcherCloudAllowed : this.config.thinkerCloudAllowed;
    const emergencyOk = ctx.emergency === true && this.config.emergencyCloudAlways;
    if (!cloudAllowedForRole && !emergencyOk) {
      return { decision: 'queue', reason: `cloud-disabled-for-${ctx.role}` };
    }

    const cap = this.config.monthlyCloudMaxUsd;
    if (cap <= 0) {
      return emergencyOk
        ? { decision: 'cloud', reason: 'emergency-bypass-zero-cap' }
        : { decision: 'queue', reason: 'cloud-cap-zero' };
    }

    const spent = this.probe.monthlyCloudUsd();
    if (spent >= cap) {
      return emergencyOk
        ? { decision: 'cloud', reason: 'emergency-bypass-budget' }
        : { decision: 'queue', reason: 'cloud-cap-exhausted' };
    }

    const warn = spent / cap >= this.config.warnThreshold;
    return { decision: 'cloud', reason: 'local-full-cloud-allowed', ...(warn ? { warn: true } : {}) };
  }
}
