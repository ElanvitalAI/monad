// ── PX-4 P3: mission Turn hook ──
//
// Every LLM turn, globalMissionRegistry.tick() runs active missions'
// evaluators. When any mission is active, this hook composes a brief
// banner for systemPromptInject so the LLM sees "Mission X alive
// (iteration N)" without needing to poll a tool.
//
// Priority = 5 (reserved range). Sits after AGENTS.md (PX-5 priority 1)
// and before user plugin hooks (>= 10). globalMissionRegistry is the
// sole state — the hook itself is stateless and safe to register once
// at bootstrap (register idempotency is dispatcher-enforced).

import type { HookHandler } from '../plugin-hooks/types.js';
import type {
  TurnHookInput,
  TurnHookOutput,
} from '../plugin-hooks/events.js';
import { globalMissionRegistry, type MissionRegistry } from './registry.js';

export interface MissionTurnHookOpts {
  registry?: MissionRegistry;
  /** Test seam — let callers inject a clock. */
  now?: () => number;
  id?: string;
}

/** Build the mission Turn hook. Factory form so tests can wire a
 *  fresh registry without touching the global. */
export function buildMissionTurnHook(opts: MissionTurnHookOpts = {}): HookHandler<'Turn'> {
  const registry = opts.registry ?? globalMissionRegistry;
  return {
    id: opts.id ?? 'core:missions',
    event: 'Turn',
    priority: 5,
    timeoutMs: 5_000,
    async invoke(input: TurnHookInput): Promise<TurnHookOutput> {
      const running = await registry.tick(input.turnNumber);
      if (running.length === 0) return {};
      const banner = formatBanner(running, registry);
      return { systemPromptInject: banner };
    },
  };
}

function formatBanner(
  running: Array<{ id: string; name: string }>,
  registry: MissionRegistry,
): string {
  const lines: string[] = ['Active missions:'];
  for (const def of running) {
    const state = registry.state(def.id);
    const iter = state?.iteration ?? 0;
    const lastErr = state?.lastResult?.error;
    const suffix = lastErr ? ` (last error: ${lastErr})` : '';
    lines.push(`  - ${def.id}: iteration ${iter}/${/* max from def */ ''}${suffix}`);
  }
  return lines.join('\n');
}
