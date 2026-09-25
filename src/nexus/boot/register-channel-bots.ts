// NEXUS · channel-bot kind register/auto-start (extracted from nexus/index.ts in C-2d)
//
// Sibling to register-daemon.ts / register-pwa-host.ts / register-settings.ts.
// god-file pressure relief per `내부 문서 `ROADMAP-nexus-daemon-naming-cleanup-2026-05-08``
// §C-2. Insertion-only style: same logic, just relocated.
//
// PR θ — channel-bot is opt-in via `enableChannelBots: ChannelBotPlatform[]`.
// One tab per requested platform. Token presence is decided at spec-creation
// time (`createChannelBotTabSpec` sets `meta.disabled` when env is missing) —
// the supervisor still gets the registered tab so the sidebar can render the
// "set token" guidance. Template mode (PR κ) owns the tab roster, so this
// helper skips defaults when a template is applied.

import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
import type { Supervisor } from '../supervisor/index.js';
import {
  createChannelBotTabSpec,
  detectExternalChannelBot,
  type ChannelBotPlatform,
  type ChannelBotMeta,
} from '../kinds/channel-bot.js';

export interface RegisteredChannelBot {
  id: string;
  meta: ChannelBotMeta;
}

export interface RegisterChannelBotsInputs {
  registry: TabRegistry;
  templateApplied: boolean;
  opts: {
    enableChannelBots?: ChannelBotPlatform[];
  };
}

/** PR θ — register one tab per requested platform. Returns the registered
 *  ids + meta so the auto-start pass can iterate. Empty array when no
 *  platforms requested or template is in effect. */
export function tryRegisterChannelBots({ registry, templateApplied, opts }: RegisterChannelBotsInputs): RegisteredChannelBot[] {
  const channelBotPlatforms = templateApplied ? [] : (opts.enableChannelBots ?? []);
  const registered: RegisteredChannelBot[] = [];
  for (const platform of channelBotPlatforms) {
    const spec = createChannelBotTabSpec({ platform });
    registry.register(spec);
    registered.push({ id: spec.id, meta: spec.meta as unknown as ChannelBotMeta });
  }
  return registered;
}

export interface AutoStartChannelBotsInputs {
  state: NexusState;
  registry: TabRegistry;
  supervisor: Supervisor;
  registered: RegisteredChannelBot[];
  opts: {
    autoStartChannelBots?: boolean;
    detachForTesting?: boolean;
  };
}

/** PR θ — channel-bot auto-start: skip when disabled (no token) or
 *  when an external lock holder is alive. */
export function tryAutoStartChannelBots({
  state,
  registry,
  supervisor,
  registered,
  opts,
}: AutoStartChannelBotsInputs): void {
  const autoStartChannelBots = opts.autoStartChannelBots ?? !opts.detachForTesting;
  for (const entry of registered) {
    if (entry.meta.disabled) continue;
    const detection = detectExternalChannelBot({ state, registry, tabId: entry.id });
    if (detection.outcome === 'external') continue;
    if (autoStartChannelBots) {
      void supervisor.startTab(entry.id).catch(() => { /* swallow */ });
    }
  }
}
