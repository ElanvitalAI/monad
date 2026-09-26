// Tool-hint in-memory registry + JSON file persistence.
//
// Scope semantics:
//   turn    — in-memory only, auto-cleared on endTurn()
//   session — in-memory only, lives until endSession() or process exit
//   project — persisted to ~/.config/monad-agent/hints.json, keyed by cwd
//   global  — persisted, no cwd key
//
// Writes are debounced 250 ms then atomic (tmp + rename). The file
// is read-modify-written so other projects' hints aren't lost when
// this project saves. Multi-process concurrency is "last writer
// wins" — acceptable for a developer tool where hints change at
// user-input frequency, not at compute frequency.
//
// Public API is a module-level singleton (mirrors debug-log.ts).
// Tests use setConfigPathForTesting() to point at a tmpdir.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join as joinPath } from 'node:path';
import { randomBytes } from 'node:crypto';

import { getSessionCwd } from '../session/working-dir.js';
import { migrateLegacyHomeFile } from '../storage/legacy-elanous-dir-migrate.js';
import type { Hint, HintKind, HintScope, HintsFileV1 } from './types.js';

// ─── Storage ─────────────────────────────────────────────────────

/** Default path: ~/.elanous/hints.json (canonical · 2026-05-10 unification).
 *  XDG_CONFIG_HOME explicit honors legacy ~/.config/monad-agent/hints.json.
 *  FU2 Tier 2 (PLAN closing follow-up): first call migrates legacy file. */
function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return joinPath(xdg, 'monad-agent', 'hints.json');
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'hints.json'),
    elanousRel: 'hints.json',
  });
  return joinPath(homedir(), '.elanous', 'hints.json');
}

let configPathOverride: string | null = null;

/** Test seam — set to null to restore default. */
export function setConfigPathForTesting(path: string | null): void {
  configPathOverride = path;
  // Any cached in-memory state is tied to the old path — force reload.
  loaded = false;
  memory.turn = [];
  memory.session = [];
  memory.project = [];
  memory.global = [];
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

function configPath(): string {
  return configPathOverride ?? defaultConfigPath();
}

/** cwd is used as the project key. Tests override via HINTS_PROJECT_CWD.
 *  WD7 — reads from the session working directory so hints are keyed
 *  per active project instead of per launch directory. */
function projectKey(): string {
  const override = process.env.HINTS_PROJECT_CWD;
  return override && override.trim() ? override : getSessionCwd();
}

// ─── In-memory state ─────────────────────────────────────────────

interface Memory {
  turn: Hint[];
  session: Hint[];
  project: Hint[];   // current project only; other projects stay on disk
  global: Hint[];
}

const memory: Memory = { turn: [], session: [], project: [], global: [] };
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const file = readFile();
  memory.global = pruneExpired(file.global);
  memory.project = pruneExpired(file.projects[projectKey()] ?? []);
}

function readFile(): HintsFileV1 {
  const path = configPath();
  if (!existsSync(path)) return { version: 1, global: [], projects: {} };
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, global: [], projects: {} };
    const version = (parsed as { version?: unknown }).version;
    if (version !== 1) return { version: 1, global: [], projects: {} };
    const global = Array.isArray((parsed as { global?: unknown }).global)
      ? ((parsed as { global: unknown[] }).global.filter(isValidHint) as Hint[]) : [];
    const projectsRaw = (parsed as { projects?: unknown }).projects;
    const projects: Record<string, Hint[]> = {};
    if (projectsRaw && typeof projectsRaw === 'object') {
      for (const [key, list] of Object.entries(projectsRaw as Record<string, unknown>)) {
        if (Array.isArray(list)) projects[key] = list.filter(isValidHint) as Hint[];
      }
    }
    return { version: 1, global, projects };
  } catch {
    // Corrupt file — return empty rather than crash. A single bad write
    // shouldn't brick the user's next session.
    return { version: 1, global: [], projects: {} };
  }
}

function isValidHint(x: unknown): x is Hint {
  if (!x || typeof x !== 'object') return false;
  const h = x as Record<string, unknown>;
  if (typeof h.id !== 'string') return false;
  if (typeof h.tool !== 'string') return false;
  if (typeof h.kind !== 'string') return false;
  if (typeof h.scope !== 'string') return false;
  if (typeof h.createdAt !== 'number') return false;
  return true;
}

// ─── Debounced atomic save ───────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 250;

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

/** Force an immediate flush — used by tests and endSession. */
export function flushSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
}

function saveNow(): void {
  const path = configPath();
  const file = readFile();                 // re-read to preserve other projects
  file.global = memory.global;
  file.projects[projectKey()] = memory.project;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
  renameSync(tmp, path);
}

// ─── CRUD ────────────────────────────────────────────────────────

export interface AddHintInput {
  kind: HintKind;
  tool: string;
  scope: HintScope;
  reason?: string;
  expiresAt?: number;
  usesLeft?: number;
  sourceSignal?: string;
  payload?: Record<string, unknown>;
  /** Test seam — supply deterministic id + createdAt. */
  id?: string;
  createdAt?: number;
}

function newId(): string {
  return randomBytes(6).toString('base64url');  // 8 chars
}

export function addHint(input: AddHintInput): Hint {
  ensureLoaded();
  const hint: Hint = {
    id: input.id ?? newId(),
    kind: input.kind,
    tool: input.tool,
    scope: input.scope,
    reason: input.reason,
    createdAt: input.createdAt ?? Date.now(),
    expiresAt: input.expiresAt,
    usesLeft: input.usesLeft,
    sourceSignal: input.sourceSignal,
    payload: input.payload,
  };
  bucket(input.scope).push(hint);
  if (input.scope === 'project' || input.scope === 'global') scheduleSave();
  return hint;
}

export function removeHint(id: string): boolean {
  ensureLoaded();
  for (const scope of ['turn', 'session', 'project', 'global'] as HintScope[]) {
    const list = bucket(scope);
    const idx = list.findIndex(h => h.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      if (scope === 'project' || scope === 'global') scheduleSave();
      return true;
    }
  }
  return false;
}

export function listHints(scope?: HintScope): Hint[] {
  ensureLoaded();
  const now = Date.now();
  if (scope) return pruneExpired(bucket(scope), now).slice();
  // Order: turn → session → project → global so gate sees
  // most-specific first (later entries overwrite earlier with same
  // tool+kind in evaluator logic).
  return [
    ...pruneExpired(memory.turn, now),
    ...pruneExpired(memory.session, now),
    ...pruneExpired(memory.project, now),
    ...pruneExpired(memory.global, now),
  ];
}

export function resetScope(scope: HintScope | 'all'): number {
  ensureLoaded();
  let removed = 0;
  if (scope === 'all') {
    removed += memory.turn.length; memory.turn = [];
    removed += memory.session.length; memory.session = [];
    removed += memory.project.length; memory.project = [];
    // 'all' intentionally preserves global — use resetScope('global') explicitly.
    scheduleSave();
    return removed;
  }
  const list = bucket(scope);
  removed = list.length;
  list.length = 0;
  if (scope === 'project' || scope === 'global') scheduleSave();
  return removed;
}

/** Mark a hint as consumed. Decrement usesLeft; remove at 0. */
export function consumeUse(id: string): void {
  ensureLoaded();
  for (const scope of ['turn', 'session', 'project', 'global'] as HintScope[]) {
    const list = bucket(scope);
    const h = list.find(x => x.id === id);
    if (h) {
      if (h.usesLeft === undefined) return;
      h.usesLeft -= 1;
      if (h.usesLeft <= 0) {
        const idx = list.indexOf(h);
        list.splice(idx, 1);
      }
      if (scope === 'project' || scope === 'global') scheduleSave();
      return;
    }
  }
}

// ─── Lifecycle hooks ─────────────────────────────────────────────

/** Called by skill-runner when a turn ends (dispatchHostTool loop
 *  exit). Clears turn scope. */
export function endTurn(): void {
  ensureLoaded();
  memory.turn = [];
}

/** Called when an executeSkill call returns. Clears turn + session. */
export function endSession(): void {
  ensureLoaded();
  memory.turn = [];
  memory.session = [];
  flushSave();
}

// ─── Helpers ─────────────────────────────────────────────────────

function bucket(scope: HintScope): Hint[] {
  if (scope === 'turn') return memory.turn;
  if (scope === 'session') return memory.session;
  if (scope === 'project') return memory.project;
  return memory.global;
}

function pruneExpired(hints: Hint[], now: number = Date.now()): Hint[] {
  return hints.filter(h => h.expiresAt === undefined || h.expiresAt > now);
}

/** Test seam — inspect raw in-memory state. */
export function _debugState(): Memory {
  ensureLoaded();
  return {
    turn: memory.turn.slice(),
    session: memory.session.slice(),
    project: memory.project.slice(),
    global: memory.global.slice(),
  };
}

/** Test seam — force reload from disk. */
export function _reloadForTesting(): void {
  loaded = false;
  memory.turn = [];
  memory.session = [];
  memory.project = [];
  memory.global = [];
  ensureLoaded();
}
