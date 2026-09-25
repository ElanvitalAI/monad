// NEXUS · switch apply (hot vs restart) (Phase N-3 PR μ)
//
// PUT /v1/config/switches/:id calls applySwitchChange. The function:
//   1. Validates the switch + value
//   2. Writes UserConfig
//   3. Emits config.changed event
//   4. If hot → calls hotApplyHandler(switchId, value)
//   5. If !hot → schedules restart on each tab in restartTabs (literal
//      ids; for tab-scope switches the caller passes the expanded id)

import { getSwitch } from './switch-registry.js';
import { patchUserConfig, writeSwitchValue } from './user-config.js';
import { pushEvent, type NexusState } from '../state/state.js';
import type { Supervisor } from '../supervisor/index.js';
import type { TabRegistry } from '../state/tab-registry.js';
import { debug } from '../../debug/log.js';

export interface ApplySwitchOpts {
  state: NexusState;
  registry: TabRegistry;
  supervisor?: Supervisor;
  /** Hot-applicable switches dispatch through this callback. */
  hotApplyHandler?: (switchId: string, value: unknown) => void;
  /** For tab-scope switches the caller should pass the literal id
   *  (e.g., `tabs.daemon:1.httpPort`). For global-scope switches the
   *  declared id is used as-is. */
  switchId: string;
  value: unknown;
}

export interface ApplySwitchResult {
  outcome: 'hot' | 'restart' | 'no-op' | 'invalid' | 'unknown-switch';
  validationError?: string;
  restartedTabs?: string[];
}

export async function applySwitchChange(opts: ApplySwitchOpts): Promise<ApplySwitchResult> {
  // Schema match — strip the literal tab id to reach the declared template
  // (tab-scope switches in the registry use `<id>` placeholders; we look
  // up by re-templating the literal id back).
  const sw = lookupSwitchByLiteralId(opts.switchId);
  if (!sw) return { outcome: 'unknown-switch' };

  if (sw.validate) {
    const err = sw.validate(opts.value);
    if (err) return { outcome: 'invalid', validationError: err };
  }

  patchUserConfig((cfg) => writeSwitchValue(cfg, opts.switchId, opts.value));

  pushEvent(opts.state, {
    kind: 'config.changed',
    detail: {
      switchId: opts.switchId,
      hot: sw.hotApplicable,
      ...(sw.redactInLogs ? { redacted: true } : { value: opts.value }),
    },
  });

  if (debug.enabled) {
    debug.log('nexus.config.apply', opts.switchId, {
      hot: sw.hotApplicable,
      redacted: !!sw.redactInLogs,
    });
  }

  if (sw.hotApplicable) {
    try { opts.hotApplyHandler?.(opts.switchId, opts.value); } catch { /* swallow */ }
    return { outcome: 'hot' };
  }

  // Restart path. `restartTabs` lists target tab ids (with `<id>` template
  // for tab-scope switches → already expanded by the caller via the literal
  // switch id). For global switches we use restartTabs literally.
  const targets = (sw.restartTabs ?? []).map((id) => {
    if (id === '<id>' && sw.scope === 'tab') {
      // Recover tab id from the literal switch id `tabs.<tabId>.<tail>`.
      const parts = opts.switchId.split('.');
      return parts[1] ?? id;
    }
    return id;
  }).filter((id) => opts.registry.has(id));

  if (targets.length === 0 || !opts.supervisor) {
    return { outcome: 'no-op' };
  }

  for (const tabId of targets) {
    try {
      await opts.supervisor.stopTab(tabId, { graceMs: 0 });
      await opts.supervisor.startTab(tabId);
    } catch { /* surfaced via tab status */ }
  }
  return { outcome: 'restart', restartedTabs: targets };
}

function lookupSwitchByLiteralId(literalId: string) {
  // First try a direct match (global scope).
  const direct = getSwitch(literalId);
  if (direct) return direct;
  // For tab-scope switches the registry id has `<id>` placeholder.
  const parts = literalId.split('.');
  if (parts[0] === 'tabs' && parts.length >= 3) {
    const template = ['tabs', '<id>', ...parts.slice(2)].join('.');
    return getSwitch(template);
  }
  return undefined;
}
