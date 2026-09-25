// NEXUS · template loader (Phase N-3 PR κ)
//
// A template is a JSON file that declares the initial tab set NEXUS
// should boot with. There are two sources:
//   1. Builtin defaults    — bundled with this module · always available
//   2. User-saved          — `~/.monad/nexus/templates/<name>.json` ·
//                            written by POST /v1/nexus/templates from a
//                            running NEXUS snapshot
//
// User templates take precedence over builtins of the same name (so the
// user can override "default" without touching the bundle). Save refuses
// to overwrite a builtin name (returns 409); the user has to pick a new
// name to extend it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { nexusTemplatesDir } from '../paths.js';
import type { TabKind } from '../kinds/types.js';

export const TEMPLATE_VERSION = 1;

export interface TemplateTabEntry {
  kind: TabKind;
  /** Tab id; defaults inferred by the kind factory if omitted. */
  id?: string;
  label?: string;
  /** Pass-through to the kind factory (e.g., {platform:'telegram'} for channel-bot). */
  kindOpts?: Record<string, unknown>;
  /** When false, supervisor.startTab is suppressed (registration only). */
  start?: boolean;
}

export interface NexusTemplate {
  version: typeof TEMPLATE_VERSION;
  name: string;
  description: string;
  tabs: TemplateTabEntry[];
}

export interface TemplateSummary {
  name: string;
  description: string;
  source: 'builtin' | 'user';
  tabCount: number;
}

// ---------------------------------------------------------------------------
// Builtin defaults — the 4 starter scenarios per HANDOFF §2.5
// ---------------------------------------------------------------------------

const BUILTIN_DEFAULTS: NexusTemplate[] = [
  {
    version: TEMPLATE_VERSION,
    name: 'default',
    description: 'Single chat + webterm + auto daemon (N-2 baseline)',
    tabs: [
      { kind: 'chat', id: 'chat:1', label: 'chat#1' },
      { kind: 'webterm', id: 'webterm:1', label: 'webterm#1' },
      { kind: 'daemon', id: 'daemon:1' },
    ],
  },
  {
    version: TEMPLATE_VERSION,
    name: 'voice',
    description: 'Voice-first: chat + daemon + PWA host (browser UI)',
    tabs: [
      { kind: 'chat', id: 'chat:1', label: 'voice-chat' },
      { kind: 'daemon', id: 'daemon:1' },
      { kind: 'pwa-host', id: 'pwa-host:1' },
    ],
  },
  {
    version: TEMPLATE_VERSION,
    name: 'family-channel',
    description: 'Family group channel: chat + daemon + telegram bot',
    tabs: [
      { kind: 'chat', id: 'chat:1', label: 'family' },
      { kind: 'daemon', id: 'daemon:1' },
      { kind: 'channel-bot', id: 'telegram:1', kindOpts: { platform: 'telegram' } },
    ],
  },
  {
    version: TEMPLATE_VERSION,
    name: 'dev',
    description: 'Developer workstation: 2 chats + 2 webterms + daemon + PWA',
    tabs: [
      { kind: 'chat', id: 'chat:1', label: 'main' },
      { kind: 'chat', id: 'chat:2', label: 'side' },
      { kind: 'webterm', id: 'webterm:1', label: 'shell-1' },
      { kind: 'webterm', id: 'webterm:2', label: 'shell-2' },
      { kind: 'daemon', id: 'daemon:1' },
      { kind: 'pwa-host', id: 'pwa-host:1' },
    ],
  },
];

const BUILTIN_NAMES = new Set(BUILTIN_DEFAULTS.map((t) => t.name));

export function isBuiltinTemplate(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

export function listBuiltinTemplates(): NexusTemplate[] {
  // Return clones so callers can't mutate the in-memory bundle.
  return BUILTIN_DEFAULTS.map((t) => ({
    ...t,
    tabs: t.tabs.map((e) => ({ ...e, ...(e.kindOpts ? { kindOpts: { ...e.kindOpts } } : {}) })),
  }));
}

// ---------------------------------------------------------------------------
// User templates — file-system layer
// ---------------------------------------------------------------------------

function userTemplatePath(name: string): string {
  return joinPath(nexusTemplatesDir(), `${name}.json`);
}

function ensureUserTemplatesDir(): void {
  try { mkdirSync(nexusTemplatesDir(), { recursive: true }); } catch { /* best-effort */ }
}

function readUserTemplateFile(name: string): NexusTemplate | null {
  const path = userTemplatePath(name);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NexusTemplate>;
    if (parsed.version !== TEMPLATE_VERSION) return null;
    if (!Array.isArray(parsed.tabs)) return null;
    if (typeof parsed.name !== 'string' || parsed.name.length === 0) return null;
    return {
      version: TEMPLATE_VERSION,
      name: parsed.name,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      tabs: parsed.tabs as TemplateTabEntry[],
    };
  } catch {
    return null;
  }
}

function listUserTemplateFiles(): NexusTemplate[] {
  const dir = nexusTemplatesDir();
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir);
    const out: NexusTemplate[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const path = joinPath(dir, entry);
        if (!statSync(path).isFile()) continue;
        const name = entry.slice(0, -'.json'.length);
        const t = readUserTemplateFile(name);
        if (t) out.push(t);
      } catch { /* skip bad files */ }
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all templates (user takes precedence by name). */
export function listTemplates(): TemplateSummary[] {
  const userMap = new Map<string, NexusTemplate>();
  for (const t of listUserTemplateFiles()) userMap.set(t.name, t);

  const summaries: TemplateSummary[] = [];
  const seen = new Set<string>();

  for (const [name, t] of userMap) {
    summaries.push({ name, description: t.description, source: 'user', tabCount: t.tabs.length });
    seen.add(name);
  }
  for (const t of BUILTIN_DEFAULTS) {
    if (seen.has(t.name)) continue; // user overrode builtin → only show once
    summaries.push({ name: t.name, description: t.description, source: 'builtin', tabCount: t.tabs.length });
  }
  // Stable ordering: builtins first by their bundled order, then user-only alpha.
  summaries.sort((a, b) => {
    const aBuiltinIdx = BUILTIN_DEFAULTS.findIndex((t) => t.name === a.name);
    const bBuiltinIdx = BUILTIN_DEFAULTS.findIndex((t) => t.name === b.name);
    if (aBuiltinIdx >= 0 && bBuiltinIdx >= 0) return aBuiltinIdx - bBuiltinIdx;
    if (aBuiltinIdx >= 0) return -1;
    if (bBuiltinIdx >= 0) return 1;
    return a.name.localeCompare(b.name);
  });
  return summaries;
}

export function loadTemplate(name: string): NexusTemplate | null {
  // User overrides builtin
  const user = readUserTemplateFile(name);
  if (user) return user;
  const builtin = BUILTIN_DEFAULTS.find((t) => t.name === name);
  if (!builtin) return null;
  return {
    ...builtin,
    tabs: builtin.tabs.map((e) => ({
      ...e,
      ...(e.kindOpts ? { kindOpts: { ...e.kindOpts } } : {}),
    })),
  };
}

export interface SaveTemplateResult {
  outcome: 'saved' | 'builtin-conflict' | 'invalid-name';
  path?: string;
}

const SAFE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function saveTemplate(template: NexusTemplate): SaveTemplateResult {
  if (!SAFE_NAME_RE.test(template.name)) return { outcome: 'invalid-name' };
  if (BUILTIN_NAMES.has(template.name)) return { outcome: 'builtin-conflict' };
  ensureUserTemplatesDir();
  const path = userTemplatePath(template.name);
  const payload: NexusTemplate = {
    version: TEMPLATE_VERSION,
    name: template.name,
    description: template.description ?? '',
    tabs: template.tabs,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return { outcome: 'saved', path };
}

export function deleteUserTemplate(name: string): boolean {
  if (BUILTIN_NAMES.has(name)) return false;
  const path = userTemplatePath(name);
  if (!existsSync(path)) return false;
  try {
    require('node:fs').unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
