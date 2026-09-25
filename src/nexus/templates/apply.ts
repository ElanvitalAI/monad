// NEXUS · template application (Phase N-3 PR κ)
//
// Translates a NexusTemplate into registry.register + supervisor.startTab
// calls. Reuses the same per-kind factory dispatch as the write API
// (PR ι) so template loading and HTTP creation share a single path.

import type { Supervisor } from '../supervisor/index.js';
import type { TabRegistry } from '../state/tab-registry.js';
import type { TabSpec, TabKind } from '../kinds/types.js';
import { createChatTabSpec } from '../kinds/chat.js';
import { createWebtermTabSpec } from '../kinds/webterm.js';
import { createDaemonTabSpec } from '../kinds/daemon.js';
import { createPwaHostTabSpec } from '../kinds/pwa-host.js';
import {
  createChannelBotTabSpec,
  type ChannelBotPlatform,
} from '../kinds/channel-bot.js';
// Surface-unification v2.2 V2.2-8 (2026-05-11) — scheduler kind retired.
import type { NexusTemplate, TemplateTabEntry } from './loader.js';

const SPAWNABLE_KINDS: ReadonlySet<TabKind> = new Set([
  'daemon', 'pwa-host', 'channel-bot',
]);

export interface TemplateApplyOpts {
  registry: TabRegistry;
  supervisor?: Supervisor;
  /** When true (default), supervisor.startTab is invoked for spawn-able
   *  kinds whose template entry doesn't set start=false. */
  autoStart?: boolean;
}

export interface TemplateApplyResult {
  registered: { id: string; kind: TabKind }[];
  skipped: { id?: string; kind: string; reason: string }[];
  started: string[];
}

export async function applyTemplate(
  template: NexusTemplate,
  opts: TemplateApplyOpts,
): Promise<TemplateApplyResult> {
  const result: TemplateApplyResult = { registered: [], skipped: [], started: [] };
  const autoStart = opts.autoStart ?? true;

  for (const entry of template.tabs) {
    const built = buildSpec(entry);
    if (!built) {
      result.skipped.push({ ...(entry.id ? { id: entry.id } : {}), kind: entry.kind, reason: 'unbuildable' });
      continue;
    }
    if (opts.registry.has(built.id)) {
      result.skipped.push({ id: built.id, kind: built.kind, reason: 'id-conflict' });
      continue;
    }
    opts.registry.register(built);
    result.registered.push({ id: built.id, kind: built.kind });

    if (autoStart && opts.supervisor && SPAWNABLE_KINDS.has(built.kind) && entry.start !== false) {
      try {
        await opts.supervisor.startTab(built.id);
        if (opts.registry.get(built.id)?.pid != null) result.started.push(built.id);
      } catch {
        // Spawn failure surfaces via tab status / events — non-fatal.
      }
    }
  }
  return result;
}

function buildSpec(entry: TemplateTabEntry): TabSpec | null {
  const opts = {
    ...(entry.id !== undefined ? { id: entry.id } : {}),
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.kindOpts ?? {}),
  } as Record<string, unknown>;
  switch (entry.kind) {
    case 'chat':       return createChatTabSpec(opts as Parameters<typeof createChatTabSpec>[0]);
    case 'webterm':    return createWebtermTabSpec(opts as Parameters<typeof createWebtermTabSpec>[0]);
    case 'daemon':     return createDaemonTabSpec(opts as Parameters<typeof createDaemonTabSpec>[0]);
    case 'pwa-host':   return createPwaHostTabSpec(opts as Parameters<typeof createPwaHostTabSpec>[0]);
    case 'channel-bot': {
      const platform = (entry.kindOpts?.platform ?? '') as ChannelBotPlatform;
      if (platform !== 'telegram' && platform !== 'discord') return null;
      return createChannelBotTabSpec({
        platform,
        ...(opts as Omit<Parameters<typeof createChannelBotTabSpec>[0], 'platform'>),
      });
    }
    // Surface-unification v2.2 V2.2-8 (2026-05-11) — scheduler kind retired.
    default:           return null;
  }
}

/** Snapshot the current registry as a TemplateTabEntry list. Used by
 *  POST /v1/nexus/templates to persist the live state under a name. */
export function snapshotRegistryAsEntries(registry: TabRegistry): TemplateTabEntry[] {
  return registry.list().map((tab) => {
    const entry: TemplateTabEntry = {
      kind: tab.spec.kind,
      id: tab.spec.id,
      label: tab.spec.label,
    };
    // channel-bot needs platform recovery from meta
    if (tab.spec.kind === 'channel-bot') {
      const meta = tab.spec.meta as { platform?: ChannelBotPlatform } | undefined;
      if (meta?.platform) entry.kindOpts = { platform: meta.platform };
    }
    return entry;
  });
}
