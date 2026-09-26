// Persona registry — directory load + cache + reload.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.2 (M2.1)
//
// Owns the (personaId → PersonaProfile) map. Loads all *.yaml files
// from a directory, validates each via loader, and exposes them via
// `get` / `list` / `has`.
//
// File watch (fs.watch) is OPT-IN — caller invokes `startWatch()` if
// hot-reload desired. Default = explicit `reload()` only. Sprint 22
// (G2 full PersonaProfile) will swap fs.watch for chokidar with
// debouncing + cross-fs-event normalization.

import { readFile, readdir } from 'node:fs/promises';
import { type FSWatcher, watch as fsWatch } from 'node:fs';
import { extname, join } from 'node:path';
import { debug } from '../debug/log.js';
import { parsePersonaYaml } from './loader.js';
import type { PersonaLoadError, PersonaProfile } from './types.js';

/** Result of a directory load — loaded profiles + accumulated errors
 *  (loader doesn't throw on per-file invalid yaml; caller decides). */
export interface PersonaLoadResult {
  readonly profiles: ReadonlyMap<string, PersonaProfile>;
  readonly errors: readonly PersonaLoadError[];
  readonly loadedFiles: readonly string[];   // absolute paths
}

/** Persona registry. Single instance per elanous process. */
export class PersonaRegistry {
  private readonly byId = new Map<string, PersonaProfile>();
  private readonly fileToId = new Map<string, string>();   // absPath → personaId
  private readonly dirs: string[] = [];
  private watchers: FSWatcher[] = [];
  private readonly listeners = new Set<(event: PersonaRegistryEvent) => void>();

  /** Load all `*.yaml` (and `*.yml`) files under `dir`. Files
   *  starting with `_` (e.g., `_company.yaml`) are SKIPPED — they're
   *  reserved for company / group metadata in G8.
   *
   *  Idempotent: if called twice with same dir, second call rescans
   *  (replaces the existing entries from that dir). */
  async loadDir(dir: string): Promise<PersonaLoadResult> {
    if (!this.dirs.includes(dir)) this.dirs.push(dir);
    return this.scanAndApply(dir);
  }

  /** Reload from all previously-loaded directories. */
  async reloadAll(): Promise<PersonaLoadResult> {
    const profiles = new Map<string, PersonaProfile>();
    const errors: PersonaLoadError[] = [];
    const loadedFiles: string[] = [];

    // Wipe and rescan in deterministic order.
    this.byId.clear();
    this.fileToId.clear();
    for (const dir of this.dirs) {
      const r = await this.scanAndApply(dir);
      for (const [id, p] of r.profiles) profiles.set(id, p);
      errors.push(...r.errors);
      loadedFiles.push(...r.loadedFiles);
    }
    this.emit({ kind: 'reload-all', count: profiles.size });
    return { profiles, errors, loadedFiles };
  }

  /** Reload a single file (e.g., from an fs.watch trigger). Returns
   *  the new profile, or null if the file is missing/invalid (the
   *  prior entry is dropped in that case). */
  async reloadFile(absPath: string): Promise<PersonaProfile | null> {
    const ext = extname(absPath).toLowerCase();
    if (ext !== '.yaml' && ext !== '.yml') return null;

    let text: string;
    try {
      text = await readFile(absPath, 'utf8');
    } catch (err: unknown) {
      // file deleted / unreadable → drop prior entry
      const priorId = this.fileToId.get(absPath);
      if (priorId !== undefined) {
        this.byId.delete(priorId);
        this.fileToId.delete(absPath);
        this.emit({ kind: 'remove', personaId: priorId, path: absPath });
      }
      if (debug.enabled) {
        debug.log('persona.reload.io-error', `path=${absPath}`, {
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
      return null;
    }
    const r = parsePersonaYaml(text, absPath);
    if (!r.ok) {
      if (debug.enabled) {
        debug.log('persona.reload.invalid', `path=${absPath}`, { error: r.error.message });
      }
      return null;
    }
    // If reloading mapped to a different personaId, drop the old.
    const prior = this.fileToId.get(absPath);
    if (prior !== undefined && prior !== r.profile.personaId) {
      this.byId.delete(prior);
    }
    this.byId.set(r.profile.personaId, r.profile);
    this.fileToId.set(absPath, r.profile.personaId);
    this.emit({ kind: 'upsert', personaId: r.profile.personaId, path: absPath });
    return r.profile;
  }

  get(personaId: string): PersonaProfile | undefined {
    return this.byId.get(personaId);
  }

  has(personaId: string): boolean {
    return this.byId.has(personaId);
  }

  list(): PersonaProfile[] {
    return Array.from(this.byId.values());
  }

  size(): number {
    return this.byId.size;
  }

  /** Directories this registry actually loaded, in layer order. */
  loadedDirectories(): readonly string[] {
    return this.dirs;
  }

  /** Subscribe to load/reload events. Returns unsubscribe fn. */
  on(listener: (event: PersonaRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Start fs.watch on each loaded directory. Triggers reloadFile
   *  on yaml changes. Idempotent — second call is no-op.
   *
   *  Sprint 22 (G2): swap for chokidar with debounce + ready event. */
  startWatch(): void {
    if (this.watchers.length > 0) return;
    for (const dir of this.dirs) {
      try {
        const w = fsWatch(dir, { persistent: false }, (_event, filename) => {
          if (!filename) return;
          const ext = extname(filename).toLowerCase();
          if (ext !== '.yaml' && ext !== '.yml') return;
          if (filename.startsWith('_')) return;
          // best-effort, silent on individual failure
          void this.reloadFile(join(dir, filename)).catch(() => {});
        });
        this.watchers.push(w);
      } catch (err: unknown) {
        if (debug.enabled) {
          debug.log('persona.watch.start-error', `dir=${dir}`, {
            error: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
    }
  }

  /** Stop all watchers. Safe to call multiple times. */
  stopWatch(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch { /* swallow */ }
    }
    this.watchers = [];
  }

  // ── internal ─────────────────────────────────────────────────

  private async scanAndApply(dir: string): Promise<PersonaLoadResult> {
    const profiles = new Map<string, PersonaProfile>();
    const errors: PersonaLoadError[] = [];
    const loadedFiles: string[] = [];

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err: unknown) {
      errors.push({
        code: 'io', path: dir,
        message: `readdir failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { profiles, errors, loadedFiles };
    }

    for (const entry of entries) {
      const ext = extname(entry).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') continue;
      if (entry.startsWith('_')) continue;  // reserved
      const absPath = join(dir, entry);
      let text: string;
      try {
        text = await readFile(absPath, 'utf8');
      } catch (err: unknown) {
        errors.push({
          code: 'io', path: absPath,
          message: `read failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      const r = parsePersonaYaml(text, absPath);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      const id = r.profile.personaId;
      if (this.byId.has(id) && this.fileToId.get(absPath) !== id) {
        errors.push({
          code: 'duplicate-id', path: absPath,
          message: `persona '${id}' already loaded (from another file)`,
        });
        continue;
      }
      this.byId.set(id, r.profile);
      this.fileToId.set(absPath, id);
      profiles.set(id, r.profile);
      loadedFiles.push(absPath);
    }
    if (debug.enabled) {
      debug.log('persona.load', `dir=${dir}`, {
        loaded: profiles.size, errors: errors.length,
      });
    }
    this.emit({ kind: 'load-dir', dir, count: profiles.size, errors: errors.length });
    return { profiles, errors, loadedFiles };
  }

  private emit(event: PersonaRegistryEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* swallow */ }
    }
  }
}

export type PersonaRegistryEvent =
  | { kind: 'load-dir'; dir: string; count: number; errors: number }
  | { kind: 'reload-all'; count: number }
  | { kind: 'upsert'; personaId: string; path: string }
  | { kind: 'remove'; personaId: string; path: string };
