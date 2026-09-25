// ── PFC PX-1: plugin-contributed agent loader ──
//
// Scans `<projectRoot>/plugins/<name>/` for `plugin.json` manifests,
// extracts `contributes.agents[]`, and materialises each entry into an
// AgentDefinition with `source: 'plugin-builtin'`. Two entry shapes:
//
//  { bodyPath: './agents/explore.md' }   — external md file, parsed via parseAgentFile
//  { id: 'plan', systemPrompt: '...', ... }  — inline, constructed directly
//
// Results feed the `pluginAgents` parameter of loadAgents(), so they sit
// between the shipped src/agents/ layer and the user ~/.claude/agents/
// layer.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { parseAgentFile, parseAgentFrontmatter } from './loader.js';
import type { AgentDefinition } from './types.js';
import { loadPluginManifestFromDir, type PluginAgentContribution } from '../plugins/core/manifest.js';

export interface PluginAgentLoadResult {
  defs: AgentDefinition[];
  errors: string[];
}

export function loadPluginContributedAgents(
  projectRoot: string = process.cwd(),
  pluginsRoot: string = 'plugins',
): PluginAgentLoadResult {
  const defs: AgentDefinition[] = [];
  const errors: string[] = [];
  const root = isAbsolute(pluginsRoot) ? pluginsRoot : join(projectRoot, pluginsRoot);
  if (!existsSync(root)) return { defs, errors };

  let entries: string[] = [];
  try { entries = readdirSync(root); } catch (err: any) {
    errors.push(`${root}: readdir failed: ${err?.message ?? err}`);
    return { defs, errors };
  }

  for (const name of entries) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const pluginDir = join(root, name);
    try {
      if (!statSync(pluginDir).isDirectory()) continue;
    } catch { continue; }

    let load;
    try {
      load = loadPluginManifestFromDir(pluginDir, { id: name });
    } catch (err: any) {
      errors.push(`${pluginDir}: manifest: ${err?.message ?? err}`);
      continue;
    }
    const agents = load.manifest.contributes.agents;
    if (!agents || agents.length === 0) continue;

    for (const entry of agents) {
      const r = materialiseEntry(entry, pluginDir);
      if (r.ok) defs.push(r.def);
      else errors.push(r.error);
    }
  }
  return { defs, errors };
}

function materialiseEntry(
  entry: PluginAgentContribution,
  pluginDir: string,
): { ok: true; def: AgentDefinition } | { ok: false; error: string } {
  // bodyPath → delegate to parseAgentFile (frontmatter + body, full field set)
  if (entry.bodyPath) {
    const abs = resolve(pluginDir, entry.bodyPath);
    if (!existsSync(abs)) return { ok: false, error: `${abs}: bodyPath not found` };
    const fallback = entry.id ?? basename(abs, '.md');
    const def = parseAgentFile(abs, fallback, 'plugin-builtin');
    if (!def) return { ok: false, error: `${abs}: parseAgentFile returned null` };
    // Manifest may override id/name/description — manifest wins.
    const overridden: AgentDefinition = {
      ...def,
      ...(entry.id ? { name: entry.id } : {}),
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.description ? { description: entry.description } : {}),
    };
    return { ok: true, def: overridden };
  }

  // Inline: synthesise a frontmatter block so parseAgentFrontmatter +
  // field coercion paths apply identically to bodyPath.
  if (!entry.id) {
    return { ok: false, error: `${pluginDir}: inline agent entry missing id` };
  }
  const body = entry.systemPrompt ?? '';
  const fmLines: string[] = [
    '---',
    `name: ${entry.name ?? entry.id}`,
    ...(entry.description ? [`description: ${String(entry.description).replace(/\n/g, ' ')}`] : []),
    ...(entry.role ? [`role: ${entry.role}`] : []),
    ...(entry.goal ? [`goal: ${entry.goal}`] : []),
    ...(entry.backstory ? [`backstory: ${entry.backstory}`] : []),
    ...(entry.model ? [`model: ${entry.model}`] : []),
    ...(entry.permissionMode ? [`permissionMode: ${entry.permissionMode}`] : []),
    ...(entry.tools ? [`tools: [${entry.tools.join(', ')}]`] : []),
    ...(entry.disallowedTools ? [`disallowedTools: [${entry.disallowedTools.join(', ')}]`] : []),
    ...(entry.omitInheritedContext !== undefined
      ? [`omitInheritedContext: ${entry.omitInheritedContext}`]
      : entry.omitClaudeMd !== undefined
        ? [`omitClaudeMd: ${entry.omitClaudeMd}`]
        : []),
    ...(entry.maxTurns !== undefined ? [`maxTurns: ${entry.maxTurns}`] : []),
    ...(entry.isolation ? [`isolation: ${entry.isolation}`] : []),
    ...(entry.color ? [`color: ${entry.color}`] : []),
    '---',
    body,
  ];
  const synthetic = fmLines.join('\n');
  const { fm, body: parsedBody } = parseAgentFrontmatter(synthetic);
  if (!parsedBody.trim() && !entry.systemPrompt) {
    // An inline entry with no body is still valid as long as role/goal/
    // backstory supply something. But skill-tool-agent requires a non-
    // empty systemPrompt — keep a marker line so composeSystemPrompt has
    // something to emit.
  }

  // We can't call parseAgentFile (it's file-based). Re-implement the
  // minimal def construction here, mirroring the loader's branches.
  const def: AgentDefinition = {
    name: String(fm.name),
    systemPrompt: parsedBody.trim() || '(no body)',
    source: 'plugin-builtin',
    sourcePath: `${pluginDir}:inline:${entry.id}`,
  };
  if (typeof fm.model === 'string') def.model = fm.model;
  if (Array.isArray(fm.tools)) def.tools = fm.tools as string[];
  if (Array.isArray(fm.disallowedTools)) def.disallowedTools = fm.disallowedTools as string[];
  if (typeof fm.description === 'string') def.description = fm.description;
  if (typeof fm.role === 'string') def.role = fm.role;
  if (typeof fm.goal === 'string') def.goal = fm.goal;
  if (typeof fm.backstory === 'string') def.backstory = fm.backstory;
  if (typeof fm.permissionMode === 'string') {
    def.permissionMode = fm.permissionMode as AgentDefinition['permissionMode'];
  }
  if (typeof fm.maxTurns === 'number') def.maxTurns = fm.maxTurns;
  if (fm.isolation === 'worktree' || fm.isolation === 'cwd') def.isolation = fm.isolation;
  const omitInheritedContext = typeof fm.omitInheritedContext === 'boolean'
    ? fm.omitInheritedContext
    : typeof fm.omitClaudeMd === 'boolean'
      ? fm.omitClaudeMd
      : undefined;
  if (omitInheritedContext !== undefined) def.omitInheritedContext = omitInheritedContext;
  if (typeof fm.color === 'string') def.color = fm.color;

  return { ok: true, def };
}
