import { createRequire } from 'node:module';
import type { LLMToolSpec } from '../llm.js';
import type { NativeToolCatalogEntry } from '../native-tool-catalog.js';
import type { ToolRunResult, ToolRuntime } from './types.js';

/** Canonical names for the read-only self-cognition surface. */
export const SELF_COGNITION_TOOL_NAMES = [
  'self_recall',
  'logs_query',
  'ops_status',
  'memory_recall',
] as const;

type SelfCognitionToolName = (typeof SELF_COGNITION_TOOL_NAMES)[number];
type CoreToolsModule = typeof import('../domains/core-tools.js');

const require = createRequire(import.meta.url);

function coreTools(): CoreToolsModule {
  return require('../domains/core-tools.js') as CoreToolsModule;
}

function coreSpec(name: SelfCognitionToolName): LLMToolSpec {
  const spec = coreTools().CORE_TOOL_SPECS.find(candidate => candidate.name === name);
  if (!spec) throw new Error(`Missing core tool spec for self-cognition runtime '${name}'`);
  return spec;
}

function toToolRunResult(result: unknown): ToolRunResult {
  return typeof result === 'object' && result !== null
    ? result as Record<string, unknown>
    : { output: String(result) };
}

export const SELF_COGNITION_RUNTIMES: readonly ToolRuntime[] = SELF_COGNITION_TOOL_NAMES.map(name => ({
  id: name,
  get spec() {
    return coreSpec(name);
  },
  run: async (args) => toToolRunResult(await coreTools().buildCoreTools().dispatch(name, args)),
}));

/** MCP catalog metadata derived from the same name ledger as the runtimes. */
export const SELF_COGNITION_MCP_CATALOG_ENTRIES: readonly NativeToolCatalogEntry[] = SELF_COGNITION_TOOL_NAMES.map(name => ({
  id: name,
  kind: 'other',
  aliases: [name],
  displayName: name,
  description: 'Read-only self-cognition query over elanous history, memory, operations, or logs.',
  promptSummary: `\`${name}\` (read-only self-cognition query)`,
  host: ['mcp'],
  safety: ['read-only'],
  supportsParallel: true,
  defaultEnabled: true,
  intentScope: 'ops-ui',
}));
