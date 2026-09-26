// Global PersonaRegistry singleton — process-wide reuse for callers
// that don't manage their own registry (Showroom multi-llm-bridge,
// `/v1/personas` REST). Discord (sprint21-runtime) keeps its own
// instance for now to avoid retrofitting; the singleton coexists.
//
// Lazy initialization:
//   - First access layers `~/.elanous/personas/` (or env override)
//     beneath the repository `personas/` directory.
//   - Callers can `setGlobalPersonaRegistryDir(dir)` before first
//     access to override the state-layer directory.
//   - Subsequent accesses return the cached instance immediately.
//
// PLAN: 내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07` §6.4 (per-panel
// persona) — daemon-side hook for `assemblePersonaPrompt` injection
// in multi-llm-bridge.

import { access, stat } from 'node:fs/promises';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { PersonaRegistry, type PersonaLoadResult } from './registry.js';
import type { PersonaLoadError, PersonaProfile } from './types.js';

type NodeError = Error & { code?: string };

let _registry: PersonaRegistry | null = null;
let _registryDir: string | null = null;
let _registryDirIsExplicit = false;
let _loadPromise: Promise<PersonaLoadResult> | null = null;
let _layeredWatchUnsubscribe: (() => void) | null = null;
const layeredPersonaDirs = new WeakMap<PersonaRegistry, readonly string[]>();

/** Set the persona dir before the first global registry access. Once
 *  the registry is created, this is a no-op (call `reloadGlobalPersonaRegistry`
 *  to switch dirs at runtime). */
export function setGlobalPersonaRegistryDir(dir: string): void {
  if (_registry) {
    debug.log('persona.global', 'set-dir-ignored', {
      reason: 'already-initialized',
      attempted: dir,
      current: _registryDir,
    });
    return;
  }
  _registryDir = dir;
  _registryDirIsExplicit = true;
}

/** Resolve the state dir we'd use for first init: explicit set > env >
 *  default `~/.elanous/personas/`. */
function resolveDefaultDir(): string {
  if (_registryDir) return _registryDir;
  const env = process.env.ELANOUS_PERSONAS_DIR;
  if (env && env.length > 0) return env;
  // ⛔⭐ `homedir()/.elanous` 를 «직접» 쓰면 --test 우주가 «운영» 페르소나를 읽는다.
  //    격리는 4우주라 뿌리를 리졸버로 «한 번» 해석해야 한다.
  return join(elanousStateRoot(), 'personas');
}

/** 상태 층의 페르소나 디렉터리. ⛔ 소비자가 «자기 손으로» 계산하면 전역과 갈리고
 *  --test 우주가 운영 페르소나를 읽는다 — 그래서 여기 하나로 둔다. */
export function resolveStatePersonaDir(): string {
  const env = process.env.ELANOUS_PERSONAS_DIR;
  if (env && env.length > 0) return env;
  return join(elanousStateRoot(), 'personas');
}

export function resolveRepositoryPersonaDir(): string {
  return join(import.meta.dir, '..', '..', 'personas');
}

/** The browser entry points must name every directory their registry scanned,
 * including a test universe's state layer and the repository fallback layer. */
export function describeMissingPersona(personaId: string, registry: PersonaRegistry): string {
  const ids = registry.list().map((profile) => profile.personaId).sort();
  const scannedDirs = layeredPersonaDirs.get(registry) ?? registry.loadedDirectories();
  return `persona not found: ${personaId} — scanned: ${scannedDirs.length ? scannedDirs.join(', ') : '(none)'}; found personaIds: ${ids.length ? ids.join(', ') : '(none)'}`;
}

export async function loadLayeredPersonaDirs(
  registry: PersonaRegistry,
  dirs: readonly string[],
): Promise<PersonaLoadResult> {
  layeredPersonaDirs.set(registry, [...dirs]);
  const profiles = new Map<string, PersonaProfile>();
  const errors: PersonaLoadError[] = [];
  const loadedFiles: string[] = [];
  const loaded: string[] = [];
  const skipped: string[] = [];

  for (const dir of dirs) {
    try {
      await access(dir);
      if (!(await stat(dir)).isDirectory()) {
        const error = new Error(`persona directory is not a directory: ${dir}`) as NodeError;
        error.code = 'ENOTDIR';
        throw error;
      }
    } catch (error: unknown) {
      if ((error as NodeError).code !== 'ENOENT') throw error;
      skipped.push(dir);
      continue;
    }

    const result = await registry.loadDir(dir);
    const overrides = new Set(result.errors
      .filter((error) => error.code === 'duplicate-id')
      .map((error) => error.path));
    for (const [id, profile] of result.profiles) profiles.set(id, profile);
    errors.push(...result.errors.filter((error) => !overrides.has(error.path)));
    loadedFiles.push(...result.loadedFiles);
    loaded.push(dir);

    for (const path of overrides) {
      const profile = await registry.reloadFile(path);
      if (profile) {
        profiles.set(profile.personaId, profile);
        loadedFiles.push(path);
      }
    }
  }

  debug.log('persona.global', 'layered-load', {
    dirs: loaded,
    skipped,
    count: registry.size(),
  });
  return { profiles, errors, loadedFiles };
}

export function watchLayeredPersonaDirs(
  registry: PersonaRegistry,
  dirs: readonly string[],
  onReload?: (reload: Promise<PersonaLoadResult>) => void,
): () => void {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = registry.on((event) => {
    if (event.kind !== 'upsert' && event.kind !== 'remove') return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      onReload?.(registry.reloadAll().then(() => loadLayeredPersonaDirs(registry, dirs)));
    }, 0);
  });
  return () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    unsubscribe();
  };
}

/** Get the global registry instance. Triggers lazy init on first
 *  call — the dir scan runs in the background and the returned
 *  registry will be empty until the load completes. Callers that
 *  need to await the initial load should use `awaitGlobalPersonaLoad`. */
export function getGlobalPersonaRegistry(): PersonaRegistry {
  if (!_registry) {
    _registry = new PersonaRegistry();
    const dir = resolveDefaultDir();
    const dirs = _registryDirIsExplicit ? [dir] : [dir, resolveRepositoryPersonaDir()];
    _registryDir = dir;
    debug.log('persona.global', 'init', { dir, dirs });
    _loadPromise = loadLayeredPersonaDirs(_registry, dirs).then((result) => {
      try {
        _layeredWatchUnsubscribe = watchLayeredPersonaDirs(_registry!, dirs, (reload) => {
          _loadPromise = reload;
        });
        _registry?.startWatch();
      } catch (err) {
        debug.log('persona.global', 'watch-error', {
          dir,
          error: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
      return result;
    }).catch((err: unknown) => {
      debug.log('persona.global', 'init-error', {
        dir,
        error: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
      throw err;
    });
  }
  return _registry;
}

/** Await the in-flight initial load (or the most recent reload). When
 *  the global registry hasn't been touched yet, this initializes it
 *  synchronously by calling `getGlobalPersonaRegistry`. */
export async function awaitGlobalPersonaLoad(): Promise<PersonaLoadResult> {
  getGlobalPersonaRegistry();
  return _loadPromise ?? { profiles: new Map(), errors: [], loadedFiles: [] };
}

/** Force a reload of the global registry from a (possibly new) dir.
 *  Useful when user config changes at runtime or for tests. */
export async function reloadGlobalPersonaRegistry(
  dir?: string,
): Promise<PersonaLoadResult> {
  if (dir) {
    _layeredWatchUnsubscribe?.();
    _layeredWatchUnsubscribe = null;
    _registry?.stopWatch();
    _registry = null;
    _loadPromise = null;
    _registryDir = dir;
    _registryDirIsExplicit = true;
    return awaitGlobalPersonaLoad();
  }
  if (!_registry) return awaitGlobalPersonaLoad();
  const dirs = _registryDirIsExplicit
    ? [resolveDefaultDir()]
    : [resolveDefaultDir(), resolveRepositoryPersonaDir()];
  const reload = (_loadPromise ?? Promise.resolve({ profiles: new Map(), errors: [], loadedFiles: [] }))
    .then(() => _registry!.reloadAll())
    .then(() => loadLayeredPersonaDirs(_registry!, dirs));
  _loadPromise = reload;
  const result = await reload;
  debug.log('persona.global', 'reload', {
    dir: _registryDir,
    count: result.profiles.size,
  });
  return result;
}

/** Test seam — drop the singleton and any pending load promise so
 *  test cases can build a fresh state without process-wide bleed. */
export function _resetGlobalPersonaRegistryForTest(): void {
  _layeredWatchUnsubscribe?.();
  _layeredWatchUnsubscribe = null;
  _registry?.stopWatch();
  _registry = null;
  _registryDir = null;
  _registryDirIsExplicit = false;
  _loadPromise = null;
}
