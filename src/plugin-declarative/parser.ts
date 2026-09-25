// ── PX-7 P2: markdown + frontmatter → typed contribution ──
//
// Six kind-specific converters. Each reads a ParsedDeclaration (file
// path + frontmatter + body) and returns the same shape the manifest
// parsers in src/plugin-manifest.ts would produce — so the integration
// plugin (P5) can hand the object straight to the Layer 1 registry.
//
// Types are defined structurally so this module does not have to
// import from src/plugin-missions / src/plugin-workflows / src/plugin-
// routes. When those modules land on main their re-exports stay
// compatible; until then parsers run standalone.
//
// Error isolation: one malformed file yields null + warn; the
// catalog skips the entry so the remaining kinds keep loading.

import { basename, dirname, extname, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export type DeclarativeKind =
  | 'agents' | 'skills' | 'missions' | 'workflows' | 'hooks' | 'routes';

export interface ParsedDeclaration {
  kind: DeclarativeKind;
  id: string;
  source: 'user' | 'project';
  filePath: string;               // absolute
  frontmatter: Record<string, unknown>;
  body: string;
}

// ── Frontmatter parser (minimal YAML — same shape as agent loader) ─────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

function parseFrontmatterRaw(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { fm: {}, body: raw };
  const body = raw.slice(m[0].length);
  const fm: Record<string, unknown> = {};
  const lines = m[1]!.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const km = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!km) { i++; continue; }
    const key = km[1]!;
    const val = km[2]!.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      fm[key] = inner ? inner.split(',').map(s => stripQuotes(s.trim())) : [];
      i++;
      continue;
    }
    if (val.startsWith('{') && val.endsWith('}')) {
      // shallow inline object — simple k:v split by comma; values coerced
      const inner = val.slice(1, -1);
      const obj: Record<string, unknown> = {};
      for (const pair of inner.split(',')) {
        const [pk, pv] = pair.split(':').map(x => x.trim());
        if (pk && pv !== undefined) obj[pk] = coerceScalar(stripQuotes(pv));
      }
      fm[key] = obj;
      i++;
      continue;
    }
    if (val === '' && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]!)) {
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i]!)) {
        items.push(stripQuotes(lines[i]!.replace(/^\s+-\s+/, '').trim()));
        i++;
      }
      fm[key] = items;
      continue;
    }
    fm[key] = coerceScalar(stripQuotes(val));
    i++;
  }
  return { fm, body };
}

function coerceScalar(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── parseDeclarationFile ───────────────────────────────────────────────

export interface ParseOpts {
  onWarn?: (path: string, reason: string) => void;
}

export function parseDeclarationFile(
  filePath: string,
  kind: DeclarativeKind,
  source: 'user' | 'project',
  opts: ParseOpts = {},
): ParsedDeclaration | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    opts.onWarn?.(filePath, `read failed: ${(err as Error).message}`);
    return null;
  }
  let parsed: { fm: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatterRaw(raw);
  } catch (err) {
    opts.onWarn?.(filePath, `yaml parse failed: ${(err as Error).message}`);
    return null;
  }
  const id = resolveId(filePath, kind, parsed.fm);
  if (!id) {
    opts.onWarn?.(filePath, 'id not resolvable from filename or frontmatter');
    return null;
  }
  return {
    kind,
    id,
    source,
    filePath,
    frontmatter: parsed.fm,
    body: parsed.body,
  };
}

function resolveId(filePath: string, kind: DeclarativeKind, fm: Record<string, unknown>): string | null {
  if (typeof fm.id === 'string' && fm.id.trim()) return fm.id.trim();
  // Missions: use the parent directory name.
  if (kind === 'missions') {
    const dir = basename(dirname(filePath));
    if (dir && dir !== '.') return dir;
    return null;
  }
  // Others: filename stem.
  const base = basename(filePath, extname(filePath));
  if (base && base !== 'mission') return base;
  return null;
}

// ── Converters (structural types — no module imports) ──────────────────

/** Agent contribution matches src/plugin-manifest.ts::PluginAgentContribution
 *  shape. Structural typing keeps this module free of the agent-registry
 *  import until the integration plugin (P5) wires it up. */
export interface AgentContribution {
  id?: string;
  name?: string;
  description?: string;
  role?: string;
  goal?: string;
  backstory?: string;
  model?: string;
  permissionMode?: string;
  tools?: string[];
  disallowedTools?: string[];
  /** Deprecated external compatibility input. */
  omitClaudeMd?: boolean;
  omitInheritedContext?: boolean;
  maxTurns?: number;
  isolation?: 'worktree' | 'cwd';
  background?: boolean;
  color?: string;
  systemPrompt?: string;
}

export function toAgentContribution(parsed: ParsedDeclaration): AgentContribution {
  const fm = parsed.frontmatter;
  return {
    id: parsed.id,
    ...(typeof fm.name === 'string' ? { name: fm.name } : {}),
    ...(typeof fm.description === 'string' ? { description: fm.description } : {}),
    ...(typeof fm.role === 'string' ? { role: fm.role } : {}),
    ...(typeof fm.goal === 'string' ? { goal: fm.goal } : {}),
    ...(typeof fm.backstory === 'string' ? { backstory: fm.backstory } : {}),
    ...(typeof fm.model === 'string' ? { model: fm.model } : {}),
    ...(typeof fm.permissionMode === 'string' ? { permissionMode: fm.permissionMode } : {}),
    ...(Array.isArray(fm.tools) ? { tools: fm.tools as string[] } : {}),
    ...(Array.isArray(fm.disallowedTools) ? { disallowedTools: fm.disallowedTools as string[] } : {}),
    ...(typeof fm.omitInheritedContext === 'boolean'
      ? { omitInheritedContext: fm.omitInheritedContext }
      : typeof fm.omitClaudeMd === 'boolean'
        ? { omitInheritedContext: fm.omitClaudeMd }
        : {}),
    ...(typeof fm.maxTurns === 'number' ? { maxTurns: fm.maxTurns } : {}),
    ...(fm.isolation === 'worktree' || fm.isolation === 'cwd' ? { isolation: fm.isolation as 'worktree' | 'cwd' } : {}),
    ...(typeof fm.background === 'boolean' ? { background: fm.background } : {}),
    ...(typeof fm.color === 'string' ? { color: fm.color } : {}),
    systemPrompt: parsed.body.trim(),
  };
}

export interface MissionDefinitionLike {
  id: string;
  name: string;
  goalPath: string;        // absolute — resolved inside mission subdirectory
  sandboxPath: string;     // absolute
  evaluator: {
    command: string;
    format: 'json';
    timeoutMs?: number;
    cwd?: string;
  };
  keepPolicy: 'pass_only' | 'score_improvement' | 'never';
  maxIterations: number;
  cadence?: { everyNTurn?: number };
  autostart?: boolean;
  description?: string;
  onKeepRun?: string;
}

export function toMissionDefinition(parsed: ParsedDeclaration): MissionDefinitionLike | null {
  const fm = parsed.frontmatter;
  const dir = dirname(parsed.filePath);
  if (!(typeof fm.name === 'string' && fm.name.trim())) return null;
  const evalRaw = fm.evaluator as Record<string, unknown> | undefined;
  if (!evalRaw || typeof evalRaw !== 'object') return null;
  if (typeof evalRaw.command !== 'string' || !evalRaw.command.trim()) return null;
  const keepPolicy = fm.keepPolicy;
  if (keepPolicy !== 'pass_only' && keepPolicy !== 'score_improvement' && keepPolicy !== 'never') return null;
  const maxIter = typeof fm.maxIterations === 'number' ? fm.maxIterations : 10;
  return {
    id: parsed.id,
    name: fm.name.trim(),
    goalPath: parsed.filePath,
    sandboxPath: `${dir}/sandbox.md`,
    evaluator: {
      command: resolveRelativeTo(dir, String(evalRaw.command).trim()),
      format: 'json',
      ...(typeof evalRaw.timeoutMs === 'number' ? { timeoutMs: evalRaw.timeoutMs as number } : {}),
      ...(typeof evalRaw.cwd === 'string' ? { cwd: evalRaw.cwd as string } : {}),
    },
    keepPolicy,
    maxIterations: Math.max(1, Math.min(1000, Math.floor(maxIter))),
    ...(fm.cadence && typeof fm.cadence === 'object'
      ? { cadence: fm.cadence as { everyNTurn?: number } }
      : {}),
    ...(typeof fm.autostart === 'boolean' ? { autostart: fm.autostart } : {}),
    ...(typeof fm.description === 'string' ? { description: fm.description } : {}),
    ...(typeof fm.onKeepRun === 'string' ? { onKeepRun: fm.onKeepRun } : {}),
  };
}

function resolveRelativeTo(dir: string, path: string): string {
  if (path.startsWith('/') || path.startsWith('~')) return path;
  if (path.startsWith('./') || path.startsWith('../')) return `${dir}/${path.replace(/^\.\//, '')}`;
  return path;
}

export interface SkillWorkflowLike {
  id: string;
  name: string;
  triggers?: string[];
  steps: Array<{
    kind: 'agent' | 'skill' | 'tool' | 'askUser';
    id: string;
    args?: Record<string, unknown>;
    onError?: 'retry' | 'skip' | 'abort' | 'ask';
    maxRetries?: number;
  }>;
  description?: string;
}

export function toSkillWorkflow(parsed: ParsedDeclaration): SkillWorkflowLike | null {
  const fm = parsed.frontmatter;
  if (!(typeof fm.name === 'string' && fm.name.trim())) return null;
  if (!Array.isArray(fm.steps) || fm.steps.length === 0) return null;
  const steps = [];
  for (const raw of fm.steps as unknown[]) {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    if (s.kind !== 'agent' && s.kind !== 'skill' && s.kind !== 'tool' && s.kind !== 'askUser') return null;
    if (typeof s.id !== 'string') return null;
    steps.push({
      kind: s.kind as 'agent' | 'skill' | 'tool' | 'askUser',
      id: s.id,
      ...(s.args && typeof s.args === 'object' ? { args: s.args as Record<string, unknown> } : {}),
      ...(s.onError && typeof s.onError === 'string' ? { onError: s.onError as 'retry' | 'skip' | 'abort' | 'ask' } : {}),
      ...(typeof s.maxRetries === 'number' ? { maxRetries: s.maxRetries as number } : {}),
    });
  }
  return {
    id: parsed.id,
    name: fm.name.trim(),
    ...(Array.isArray(fm.triggers) ? { triggers: fm.triggers as string[] } : {}),
    steps,
    ...(typeof fm.description === 'string' ? { description: fm.description } : {}),
  };
}

export interface HookContributionLike {
  id: string;
  event: string;
  priority?: number;
  timeoutMs?: number;
  matcher?: string | string[];
  command: string;
  cwd?: string;
}

export function toHookContribution(parsed: ParsedDeclaration): HookContributionLike | null {
  const fm = parsed.frontmatter;
  if (typeof fm.event !== 'string' || !fm.event.trim()) return null;
  if (typeof fm.command !== 'string' || !fm.command.trim()) return null;
  return {
    id: parsed.id,
    event: fm.event.trim(),
    command: fm.command.trim(),
    ...(typeof fm.priority === 'number' ? { priority: fm.priority } : {}),
    ...(typeof fm.timeoutMs === 'number' ? { timeoutMs: fm.timeoutMs } : {}),
    ...(typeof fm.matcher === 'string' || Array.isArray(fm.matcher)
      ? { matcher: fm.matcher as string | string[] }
      : {}),
    ...(typeof fm.cwd === 'string' ? { cwd: fm.cwd } : {}),
  };
}

export interface RouteContributionLike {
  id: string;
  aliases?: string[];
  target: { kind: 'agent' | 'skill' | 'workflow' | 'mission'; id: string };
  precedence?: number;
  caseInsensitive?: boolean;
  description?: string;
}

export function toRouteContribution(parsed: ParsedDeclaration): RouteContributionLike | null {
  const fm = parsed.frontmatter;
  const target = fm.target as Record<string, unknown> | undefined;
  if (!target || typeof target !== 'object') return null;
  if (target.kind !== 'agent' && target.kind !== 'skill' && target.kind !== 'workflow' && target.kind !== 'mission') {
    return null;
  }
  if (typeof target.id !== 'string' || !target.id.trim()) return null;
  return {
    id: parsed.id,
    target: {
      kind: target.kind as 'agent' | 'skill' | 'workflow' | 'mission',
      id: target.id.trim(),
    },
    ...(Array.isArray(fm.aliases) ? { aliases: fm.aliases as string[] } : {}),
    ...(typeof fm.precedence === 'number' ? { precedence: fm.precedence } : {}),
    ...(typeof fm.caseInsensitive === 'boolean' ? { caseInsensitive: fm.caseInsensitive } : {}),
    ...(typeof fm.description === 'string' ? { description: fm.description } : {}),
  };
}

export interface SkillContributionLike {
  id: string;
  body: string;
  description?: string;
  triggers?: string[];
}

export function toSkillContribution(parsed: ParsedDeclaration): SkillContributionLike {
  const fm = parsed.frontmatter;
  return {
    id: parsed.id,
    body: parsed.body.trim(),
    ...(typeof fm.description === 'string' ? { description: fm.description } : {}),
    ...(Array.isArray(fm.triggers) ? { triggers: fm.triggers as string[] } : {}),
  };
}
