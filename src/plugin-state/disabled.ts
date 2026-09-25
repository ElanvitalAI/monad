// ── PX-2 P3: disabled.json loader ──
//
// Simple feature-toggle file at ~/.monad/disabled.json and
// <cwd>/.monad/disabled.json. The two files are merged via array union
// (each array is a deny-list, so merge is monotonic — never re-enables
// something either layer disabled).
//
// This session ships READ helpers + agent-loader integration. Writing
// is user-driven for now (hand-edit the JSON) or deferred to PX-7's
// /plugins disable <id> slash.
//
// Schema (v1):
//   {
//     "schemaVersion": 1,
//     "agents":  ["critic"],
//     "skills":  ["noisy-skill"],
//     "hooks":   [],
//     "plugins": []
//   }

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DisabledConfig {
  schemaVersion: 1;
  agents: readonly string[];
  skills: readonly string[];
  hooks: readonly string[];
  plugins: readonly string[];
}

const EMPTY: DisabledConfig = {
  schemaVersion: 1,
  agents: [],
  skills: [],
  hooks: [],
  plugins: [],
};

function userPath(): string { return join(homedir(), '.monad', 'disabled.json'); }
function projectPath(cwd: string): string { return join(cwd, '.monad', 'disabled.json'); }

function readOne(path: string, warn: (m: string) => void): DisabledConfig {
  if (!existsSync(path)) return EMPTY;
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch (err: any) { warn(`disabled.json: read failed ${path}: ${err?.message}`); return EMPTY; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { warn(`disabled.json: malformed JSON at ${path} — treating as empty`); return EMPTY; }
  if (!parsed || typeof parsed !== 'object') {
    warn(`disabled.json: not an object at ${path} — treating as empty`);
    return EMPTY;
  }
  const p = parsed as Record<string, unknown>;
  if (p.schemaVersion !== undefined && p.schemaVersion !== 1) {
    warn(`disabled.json: unsupported schemaVersion ${p.schemaVersion} at ${path} — treating as empty`);
    return EMPTY;
  }
  return {
    schemaVersion: 1,
    agents:  Array.isArray(p.agents)  ? p.agents.filter((x): x is string => typeof x === 'string')  : [],
    skills:  Array.isArray(p.skills)  ? p.skills.filter((x): x is string => typeof x === 'string')  : [],
    hooks:   Array.isArray(p.hooks)   ? p.hooks.filter((x): x is string => typeof x === 'string')   : [],
    plugins: Array.isArray(p.plugins) ? p.plugins.filter((x): x is string => typeof x === 'string') : [],
  };
}

function merge(...configs: DisabledConfig[]): DisabledConfig {
  const set = (arrs: readonly (readonly string[])[]) =>
    Array.from(new Set(arrs.flat()));
  return {
    schemaVersion: 1,
    agents:  set(configs.map(c => c.agents)),
    skills:  set(configs.map(c => c.skills)),
    hooks:   set(configs.map(c => c.hooks)),
    plugins: set(configs.map(c => c.plugins)),
  };
}

// ── Cache ───────────────────────────────────────────────────────────
//
// loaded per (cwd) tuple so SetWorkingDir flips pick up the right
// project file without a manual reload.

let cache: { cwd: string; config: DisabledConfig } | null = null;

export interface LoadDisabledOpts {
  /** Override ~/.monad path (tests). */
  userPath?: string;
  /** Override <cwd>/.monad path (tests). */
  projectPath?: string;
  warn?: (msg: string) => void;
}

export function loadDisabled(
  cwd: string = process.cwd(),
  opts: LoadDisabledOpts = {},
): DisabledConfig {
  if (cache && cache.cwd === cwd) return cache.config;
  const warn = opts.warn ?? ((m) => console.warn(m));
  const user = readOne(opts.userPath ?? userPath(), warn);
  const proj = readOne(opts.projectPath ?? projectPath(cwd), warn);
  const merged = merge(user, proj);
  cache = { cwd, config: merged };
  return merged;
}

export function reloadDisabled(cwd?: string): DisabledConfig {
  cache = null;
  return loadDisabled(cwd);
}

export function _resetDisabledCacheForTests(): void {
  cache = null;
}

// ── Public queries ──────────────────────────────────────────────────
//
// Thin wrappers over loadDisabled() so call sites read like natural
// predicates. Name normalization is intentional — disabled.json uses
// the registry's canonical name verbatim.

export function isAgentDisabled(name: string, cwd?: string, opts: LoadDisabledOpts = {}): boolean {
  return loadDisabled(cwd, opts).agents.includes(name);
}

export function isSkillDisabled(name: string, cwd?: string, opts: LoadDisabledOpts = {}): boolean {
  return loadDisabled(cwd, opts).skills.includes(name);
}

export function isHookDisabled(id: string, cwd?: string, opts: LoadDisabledOpts = {}): boolean {
  return loadDisabled(cwd, opts).hooks.includes(id);
}

export function isPluginDisabled(id: string, cwd?: string, opts: LoadDisabledOpts = {}): boolean {
  return loadDisabled(cwd, opts).plugins.includes(id);
}
