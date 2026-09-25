// H5 Phase 1 Step B · Adapter registry.
//
// Single entrypoint for launching an embodied agent session. Adapters
// self-describe which specs they handle via `supports(spec)`; the
// registry iterates in priority order and picks the first match. The
// slash command (`/acp-vw`, Step E) and VW tools use this instead of
// hard-coding a brand → path map.
//
// Intentionally tiny · no capability negotiation · no fallback chain.
// If Bundle 3/H5 P2 needs a richer selection algorithm, it can layer
// over this without breaking the contract.

import type {
  AgentAdapter,
  AgentLaunchSpec,
  EmbodiedAgentSession,
} from './embodiment.js';

interface Entry {
  readonly adapter: AgentAdapter;
  readonly priority: number;
  readonly sortOrder: number; // preserves registration order within a priority
}

export interface RegisterOpts {
  /** Higher priority adapters are tried first. Default 0.
   *  Convention: built-in adapters use 0 · user-installed overrides
   *  use positive values. */
  readonly priority?: number;
}

export class AdapterRegistry {
  private entries: Entry[] = [];
  private insertionCounter = 0;

  /** Register an adapter. Returns an unregister function so callers
   *  don't have to hold the adapter reference themselves. */
  register(adapter: AgentAdapter, opts: RegisterOpts = {}): () => void {
    const entry: Entry = {
      adapter,
      priority: opts.priority ?? 0,
      sortOrder: this.insertionCounter++,
    };
    this.entries.push(entry);
    this.resort();
    return () => {
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
    };
  }

  /** First adapter whose `supports(spec)` returns true. Returns
   *  undefined if none match — callers decide whether to throw. */
  pick(spec: AgentLaunchSpec): AgentAdapter | undefined {
    for (const entry of this.entries) {
      let matches: boolean;
      try {
        matches = entry.adapter.supports(spec);
      } catch {
        // A throwing `supports` is a bug in the adapter — treat as
        // non-match so one bad adapter doesn't block the registry.
        matches = false;
      }
      if (matches) return entry.adapter;
    }
    return undefined;
  }

  /** Pick + launch · throws with a clear message if no adapter
   *  matches, so slash commands surface actionable errors instead of
   *  silent drops. */
  async launch(spec: AgentLaunchSpec): Promise<EmbodiedAgentSession> {
    const adapter = this.pick(spec);
    if (!adapter) {
      const available = this.entries.map((e) => e.adapter.id).join(', ') || '(none)';
      throw new Error(
        `No adapter supports brand="${spec.brand}" mode="${spec.mode ?? 'auto'}". Registered: ${available}`,
      );
    }
    return adapter.launch(spec);
  }

  /** List registered adapters in priority order (read-only copy). */
  list(): readonly AgentAdapter[] {
    return this.entries.map((e) => e.adapter);
  }

  /** Drop all registrations. Test isolation helper · do not call in
   *  production code. */
  clear(): void {
    this.entries = [];
    this.insertionCounter = 0;
  }

  private resort(): void {
    this.entries.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority; // desc
      return a.sortOrder - b.sortOrder; // insertion order within priority
    });
  }
}

/** App-wide singleton. Wired into `/acp-vw <brand>` (clc / gem / lll).
 *  Adapter registration happens at module load (see `src/agent/adapters/`). */
export const defaultAdapterRegistry = new AdapterRegistry();
