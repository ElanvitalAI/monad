// ── PX-2: FS-backed plugin-state persistence ──
//
// Atomic-rename write pattern (DD-PX2-2). Optional zod schema
// validation on write AND read — read-side failure quarantines the
// corrupted file (<key>.corrupted.<ts>.json) so a later successful
// read starts clean. Single-process correctness; multi-process
// locking is a PX-6 concern.
//
// Scope selection ──
//   write: caller always names scope (default 'user' via PluginStateApi)
//   read:  FsPluginStatePersistence does NOT fall back across scopes —
//          api.ts owns the project > user precedence (so tests can
//          exercise each layer in isolation here).

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync,
  unlinkSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { userStateRoot, projectStateRoot, stateFilePath, sanitizeKey, sanitizePluginId } from './paths.js';

export type StateScope = 'user' | 'project';

export interface PluginStatePersistence {
  read<T>(pluginId: string, key: string, scope: StateScope): T | null;
  write<T>(pluginId: string, key: string, value: T, scope: StateScope): void;
  list(pluginId?: string, scope?: StateScope): StateEntry[];
  drop(pluginId: string, key?: string): void;
}

export interface StateEntry {
  pluginId: string;
  key: string;
  scope: StateScope;
  path: string;
}

/** Optional schema lookup per (pluginId, key). Returning null/undefined
 *  means "no validation" — round-trip plain JSON. Implementations that
 *  want zod coverage wire this getter to their own registry. */
export type SchemaLookup = (
  pluginId: string,
  key: string,
) => {
  parse: (value: unknown) => unknown;
} | null | undefined;

export interface FsPersistenceOpts {
  /** Override for ~/.monad/state. */
  userRoot?: string;
  /** Project root (…/.monad/state/…) for project-scope writes. When
   *  omitted, project-scope operations throw — callers that don't set
   *  a projectRoot must avoid scope='project'. */
  projectRoot?: string;
  /** Optional schema hook. When a schema exists, writes validate + reads
   *  validate-then-quarantine. */
  schema?: SchemaLookup;
  /** Logger for warnings (corruption, listener throws). Defaults to
   *  console.warn. Injectable so tests don't pollute stderr. */
  warn?: (msg: string) => void;
}

export class FsPluginStatePersistence implements PluginStatePersistence {
  private readonly userRoot: string;
  private readonly projectRoot: string | null;
  private readonly schema: SchemaLookup;
  private readonly warn: (msg: string) => void;

  constructor(opts: FsPersistenceOpts = {}) {
    this.userRoot = opts.userRoot ?? userStateRoot();
    this.projectRoot = opts.projectRoot ?? null;
    this.schema = opts.schema ?? (() => null);
    this.warn = opts.warn ?? ((m) => console.warn(m));
  }

  private rootForScope(scope: StateScope): string {
    if (scope === 'user') return this.userRoot;
    if (!this.projectRoot) {
      throw new Error(
        `plugin-state: scope='project' requires projectRoot to be configured`,
      );
    }
    return projectStateRoot(this.projectRoot);
  }

  read<T>(pluginId: string, key: string, scope: StateScope): T | null {
    const pid = sanitizePluginId(pluginId);
    const k = sanitizeKey(key);
    const path = stateFilePath(this.rootForScope(scope), pid, k);
    if (!existsSync(path)) return null;
    let raw: string;
    try { raw = readFileSync(path, 'utf-8'); }
    catch (err: any) { this.warn(`plugin-state: read I/O failed ${path}: ${err?.message}`); return null; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch {
      this.quarantine(path, 'json-parse');
      return null;
    }
    const validator = this.schema(pid, k);
    if (validator) {
      try { parsed = validator.parse(parsed); }
      catch {
        this.quarantine(path, 'schema');
        return null;
      }
    }
    return parsed as T;
  }

  write<T>(pluginId: string, key: string, value: T, scope: StateScope): void {
    const pid = sanitizePluginId(pluginId);
    const k = sanitizeKey(key);
    const validator = this.schema(pid, k);
    const toWrite = validator ? validator.parse(value) : value;
    const path = stateFilePath(this.rootForScope(scope), pid, k);
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp.${randomUUID().slice(0, 8)}`;
    writeFileSync(tmp, JSON.stringify(toWrite, null, 2), 'utf-8');
    renameSync(tmp, path);
  }

  list(pluginId?: string, scope?: StateScope): StateEntry[] {
    const out: StateEntry[] = [];
    const scopes: StateScope[] = scope ? [scope] : (this.projectRoot ? ['user', 'project'] : ['user']);
    for (const s of scopes) {
      let root: string;
      try { root = this.rootForScope(s); } catch { continue; }
      if (!existsSync(root)) continue;
      let plugins: string[];
      try { plugins = readdirSync(root); } catch { continue; }
      for (const p of plugins) {
        if (pluginId && p !== pluginId) continue;
        const pluginDir = join(root, p);
        try { if (!statSync(pluginDir).isDirectory()) continue; } catch { continue; }
        let files: string[];
        try { files = readdirSync(pluginDir); } catch { continue; }
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          if (f.includes('.corrupted.') || f.includes('.tmp.')) continue;
          const key = f.slice(0, -'.json'.length);
          out.push({ pluginId: p, key, scope: s, path: join(pluginDir, f) });
        }
      }
    }
    return out;
  }

  drop(pluginId: string, key?: string): void {
    const pid = sanitizePluginId(pluginId);
    const scopes: StateScope[] = this.projectRoot ? ['user', 'project'] : ['user'];
    for (const s of scopes) {
      let root: string;
      try { root = this.rootForScope(s); } catch { continue; }
      if (key !== undefined) {
        const k = sanitizeKey(key);
        const path = stateFilePath(root, pid, k);
        if (existsSync(path)) {
          try { unlinkSync(path); } catch { /* best-effort */ }
        }
      } else {
        const dir = join(root, pid);
        if (existsSync(dir)) {
          try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    }
  }

  /** Test helper — wipe every tracked state file. Intentionally not on
   *  the interface so a rogue plugin can't clear other plugins' state
   *  through ctx.state. */
  _resetAllForTests(): void {
    for (const s of (['user', 'project'] as const)) {
      let root: string;
      try { root = this.rootForScope(s); } catch { continue; }
      if (!existsSync(root)) continue;
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private quarantine(path: string, reason: string): void {
    try {
      const dest = `${path}.corrupted.${Date.now()}-${reason}`;
      renameSync(path, dest);
      this.warn(`plugin-state: quarantined corrupted file ${path} → ${dest}`);
    } catch (err: any) {
      this.warn(`plugin-state: quarantine failed for ${path}: ${err?.message}`);
    }
  }
}
