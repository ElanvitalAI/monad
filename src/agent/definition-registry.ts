// ── PFC PX-1: agent-definition registry ──
//
// Wraps loadAgents() to produce a layered-load report (registered count,
// per-id override history, reserved-id warnings, errors). Separate from
// `src/agent/registry.ts` which is the RUNTIME task registry (spawn/
// abort/list). This file only concerns DEFINITIONS — the static shape of
// each agent — whereas the runtime registry tracks live sub-agent
// invocations.
//
// Reserved ids (DD-PX1-3): the five PFC built-ins.
// Overriding any of them from user or project layer emits a warning;
// overriding from plugin-builtin is silent (that's the canonical source).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_AGENTS_DIR } from '../config.js';
import { isAgentDisabled } from '../plugin-state/disabled.js';
import {
  listAgentFiles,
  parseAgentFile,
} from './loader.js';
import { loadPluginContributedAgents } from './plugin-agents.js';
import type { AgentDefinition } from './types.js';

/** The five PFC built-in agents. Overridden with a warning by user /
 *  project layers; plugin-builtin overrides silently (that's where the
 *  canonical definitions ship from). */
export const RESERVED_AGENT_IDS: readonly string[] = Object.freeze([
  'explore',
  'plan',
  'research',
  'critic',
  'executor',
]);

export interface LayeredLoadReport {
  readonly registered: number;
  readonly overrides: ReadonlyArray<{
    readonly id: string;
    readonly winnerSource: NonNullable<AgentDefinition['source']>;
    readonly loserSource: NonNullable<AgentDefinition['source']>;
  }>;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface LoadLayeredOptions {
  builtinDir?: string;
  userDir?: string;
  extraUserDirs?: string[];
  projectRoot?: string;
  pluginsRoot?: string;
  skipBuiltin?: boolean;
  skipUser?: boolean;
  skipProject?: boolean;
  skipPlugin?: boolean;
  isDisabled?: (name: string) => boolean;
}

/**
 * 4-layer load with an override-aware report. Layers (lowest → highest):
 *   builtin → plugin-builtin → user → project
 * The returned report is for observability only — the Map<name, def>
 * itself lives behind the existing loadAgents() cache. Call
 * `rebuildLayeredRegistry` whenever a plugin activates or a file changes.
 */
export function loadAgentsLayered(opts: LoadLayeredOptions = {}): {
  agents: Map<string, AgentDefinition>;
  report: LayeredLoadReport;
} {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const extraUserDirs = [
    ...(opts.extraUserDirs ?? []),
    join(homedir(), '.monad', 'agents'),
  ];

  // Simulate layer walk independently so we can build the overrides
  // report. Each intermediate Map records the state before the next
  // layer installs, and we diff ids.
  const overrides: LayeredLoadReport['overrides'][number][] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const layered = new Map<string, AgentDefinition>();

  // Layer 1: builtin
  if (!opts.skipBuiltin) {
    const builtinDir = opts.builtinDir;
    const layer = collectLayer(builtinDir, 'builtin');
    mergeLayer(layered, layer.defs, overrides, warnings);
    errors.push(...layer.errors);
  }

  // Layer 2: plugin-builtin
  if (!opts.skipPlugin) {
    const pluginLayer = loadPluginContributedAgents(projectRoot, opts.pluginsRoot);
    errors.push(...pluginLayer.errors);
    mergeLayer(layered, pluginLayer.defs, overrides, warnings);
  }

  // Layer 3: user (~/.claude/agents/ + ~/.monad/agents/)
  if (!opts.skipUser) {
    const userDir = opts.userDir ?? LOCAL_AGENTS_DIR;
    const layer = collectLayer(userDir, 'user');
    mergeLayer(layered, layer.defs, overrides, warnings);
    errors.push(...layer.errors);
    for (const extra of extraUserDirs) {
      const extraLayer = collectLayer(extra, 'user');
      mergeLayer(layered, extraLayer.defs, overrides, warnings);
      errors.push(...extraLayer.errors);
    }
  }

  // Layer 4: project
  if (!opts.skipProject) {
    const projectAgentsDir = join(projectRoot, '.monad', 'agents');
    const layer = collectLayer(projectAgentsDir, 'project');
    mergeLayer(layered, layer.defs, overrides, warnings);
    errors.push(...layer.errors);
  }

  const registered = layered.size;
  const canonical = new Map(layered);
  const isDisabled = opts.isDisabled ?? ((name: string) => isAgentDisabled(name, projectRoot));
  for (const name of canonical.keys()) {
    if (isDisabled(name)) canonical.delete(name);
  }

  return {
    agents: canonical,
    report: {
      registered,
      overrides: Object.freeze(overrides),
      warnings: Object.freeze(warnings),
      errors: Object.freeze(errors),
    },
  };
}

// ── Internal helpers ──

function collectLayer(
  dir: string | undefined,
  source: NonNullable<AgentDefinition['source']>,
): { defs: AgentDefinition[]; errors: string[] } {
  const defs: AgentDefinition[] = [];
  const errors: string[] = [];
  if (!dir) return { defs, errors };
  try {
    for (const entry of listAgentFiles(dir)) {
      const def = parseAgentFile(join(dir, entry), undefined, source);
      if (def) defs.push(def);
    }
  } catch (err: any) {
    errors.push(`${dir}: ${err?.message ?? err}`);
  }
  return { defs, errors };
}

// ── PFC-S1 P1: layered resolver cache ─────────────────────────────────
//
// dispatchAgent (skill-tool-agent.ts) used to call the 2-layer
// resolveAgent() in loader.ts. That missed plugin-builtin + project
// layers. `resolveAgentLayered` builds (and caches) the 4-layer map.
// Callers pass a projectRoot hint; cache invalidation is explicit so
// tests + PX-7 fs.watch can trigger reloads.

let layeredCache: Map<string, AgentDefinition> | null = null;
let cachedProjectRoot: string | null = null;

/** Resolve a subagent_type string against the 4-layer precedence
 *  (project > user > plugin-builtin > builtin). Cached per project
 *  root so repeated spawns in the same session don't re-read the
 *  filesystem. Call `invalidateLayeredCache()` when agent files
 *  change (PX-7 will wire fs.watch). */
export function resolveAgentLayered(
  name: string,
  opts: LoadLayeredOptions = {},
): AgentDefinition | undefined {
  const projectRoot = opts.projectRoot ?? process.cwd();
  if (layeredCache === null || cachedProjectRoot !== projectRoot) {
    const { agents } = loadAgentsLayered(opts);
    layeredCache = agents;
    cachedProjectRoot = projectRoot;
  }
  return layeredCache.get(name);
}

/** Clear the cached 4-layer map. Used by tests + future fs.watch. */
export function invalidateLayeredCache(): void {
  layeredCache = null;
  cachedProjectRoot = null;
}

function mergeLayer(
  out: Map<string, AgentDefinition>,
  defs: readonly AgentDefinition[],
  overrides: Array<{ id: string; winnerSource: NonNullable<AgentDefinition['source']>; loserSource: NonNullable<AgentDefinition['source']> }>,
  warnings: string[],
): void {
  // Detect in-layer duplicates (last wins + warn).
  const seen = new Map<string, AgentDefinition>();
  for (const def of defs) {
    const prior = seen.get(def.name);
    if (prior) {
      warnings.push(
        `duplicate agent id '${def.name}' in layer '${def.source ?? 'unknown'}'` +
        ` — keeping ${def.sourcePath ?? '(inline)'}, dropping ${prior.sourcePath ?? '(inline)'}`,
      );
    }
    seen.set(def.name, def);
  }
  for (const def of seen.values()) {
    const prev = out.get(def.name);
    if (prev) {
      overrides.push({
        id: def.name,
        winnerSource: def.source ?? 'builtin',
        loserSource: prev.source ?? 'builtin',
      });
    }
    if (
      RESERVED_AGENT_IDS.includes(def.name) &&
      def.source !== 'plugin-builtin' &&
      def.source !== 'builtin'
    ) {
      warnings.push(
        `override of reserved builtin '${def.name}' by ${def.source} layer` +
        `${def.sourcePath ? ` (${def.sourcePath})` : ''}`,
      );
    }
    out.set(def.name, def);
  }
}
