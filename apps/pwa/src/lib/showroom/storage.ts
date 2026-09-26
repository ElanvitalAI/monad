/** CV-3 Showroom · P6 — named save (localStorage minimum).
 *
 *  D6 Hybrid · default ephemeral · explicit save = named layout.
 *  P6 minimum 은 client-side localStorage only (cross-device sync
 *  은 P6.2 daemon-side store).
 *
 *  Schema:
 *  ```
 *  localStorage['elanous.showroom.layouts'] = JSON.stringify({
 *    [name]: SavedShowroomLayout
 *  })
 *  ```
 *
 *  Single key holds all slots → atomic delete · 작은 footprint.
 *  Cap = 100 KB total (browser localStorage 5 MB quota 의 2% 만).
 */

import type { SavedShowroomLayout, ShowroomPanel } from './types';

const STORAGE_KEY = 'elanous.showroom.layouts';
const MAX_BYTES = 100 * 1024; // 100 KB cap

interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Resolve the localStorage backend. SSR / Node test env returns a
 *  noop backend so callers can stay agnostic. */
function getBackend(): StorageBackend {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

function readAll(backend: StorageBackend = getBackend()): Record<string, SavedShowroomLayout> {
  const raw = backend.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, SavedShowroomLayout>;
  } catch {
    return {};
  }
}

function writeAll(
  data: Record<string, SavedShowroomLayout>,
  backend: StorageBackend = getBackend(),
): { ok: true } | { ok: false; reason: string } {
  const json = JSON.stringify(data);
  if (json.length > MAX_BYTES) {
    return { ok: false, reason: `storage quota exceeded (${json.length} > ${MAX_BYTES})` };
  }
  try {
    backend.setItem(STORAGE_KEY, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Persist the current Showroom layout under `name`. Existing slot
 *  with the same name is overwritten silently. */
export function saveShowroom(
  name: string,
  panels: readonly ShowroomPanel[],
  opts: { layoutMode?: SavedShowroomLayout['layoutMode']; backend?: StorageBackend } = {},
): { ok: true; saved: SavedShowroomLayout } | { ok: false; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'name required' };
  const backend = opts.backend ?? getBackend();
  const all = readAll(backend);
  const saved: SavedShowroomLayout = {
    name: trimmed,
    savedAt: Date.now(),
    panels: panels.map((p) => ({
      id: p.id,
      kind: p.kind,
      provider: p.provider,
      ...(p.agentBrand ? { agentBrand: p.agentBrand } : {}),
      ...(p.roleHint ? { roleHint: p.roleHint } : {}),
      ...(p.personaId ? { personaId: p.personaId } : {}),
      state: p.state,
    })),
    ...(opts.layoutMode ? { layoutMode: opts.layoutMode } : {}),
  };
  all[trimmed] = saved;
  const result = writeAll(all, backend);
  if (!result.ok) return result;
  return { ok: true, saved };
}

export function loadShowroom(
  name: string,
  backend: StorageBackend = getBackend(),
): SavedShowroomLayout | null {
  const all = readAll(backend);
  return all[name.trim()] ?? null;
}

export function listSavedShowrooms(
  backend: StorageBackend = getBackend(),
): SavedShowroomLayout[] {
  return Object.values(readAll(backend)).sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteSavedShowroom(
  name: string,
  backend: StorageBackend = getBackend(),
): boolean {
  const all = readAll(backend);
  if (!(name.trim() in all)) return false;
  delete all[name.trim()];
  writeAll(all, backend);
  return true;
}

/** FP-B — daemon-side store facade (cross-device sync · #1971). When
 *  the caller passes `daemon`, save/load/list/delete try the daemon
 *  first and fall back to localStorage on error. Auto-migrate happens
 *  on first daemon save: caller's localStorage entries are pushed to
 *  daemon, then localStorage stays as a cache fallback (offline /
 *  SSR). vision Q3.
 *
 *  All helpers are async because daemon REST is async. localStorage-
 *  only callers can keep using the original sync helpers above. */

interface DaemonLayoutClient {
  listShowroomLayouts(): Promise<{ layouts: SavedShowroomLayout[] }>;
  getShowroomLayout(name: string): Promise<{ layout: SavedShowroomLayout }>;
  saveShowroomLayout(
    name: string,
    layout: Omit<SavedShowroomLayout, 'name'>,
  ): Promise<unknown>;
  deleteShowroomLayout(name: string): Promise<unknown>;
}

/** FP-B — daemon-first list with localStorage cache fallback. Returns
 *  the daemon set when the request succeeds; otherwise falls back to
 *  the cached localStorage list so offline reads still work. */
export async function listShowroomsHybrid(
  daemon: DaemonLayoutClient,
  backend: StorageBackend = getBackend(),
): Promise<{ layouts: SavedShowroomLayout[]; source: 'daemon' | 'local' }> {
  try {
    const { layouts } = await daemon.listShowroomLayouts();
    // Cache mirror — write back so the fallback path stays warm.
    const all: Record<string, SavedShowroomLayout> = {};
    for (const l of layouts) all[l.name] = l;
    writeAll(all, backend);
    return { layouts: layouts.slice().sort((a, b) => b.savedAt - a.savedAt), source: 'daemon' };
  } catch {
    return { layouts: listSavedShowrooms(backend), source: 'local' };
  }
}

/** FP-B — save through daemon + auto-migrate localStorage entries on
 *  first daemon save (when the daemon's set is empty but localStorage
 *  has entries). Caller treats this as the canonical save path. */
export async function saveShowroomHybrid(
  name: string,
  panels: readonly ShowroomPanel[],
  daemon: DaemonLayoutClient,
  opts: {
    layoutMode?: SavedShowroomLayout['layoutMode'];
    backend?: StorageBackend;
  } = {},
): Promise<
  | { ok: true; saved: SavedShowroomLayout; source: 'daemon' | 'local'; migrated: number }
  | { ok: false; reason: string }
> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'name required' };
  const backend = opts.backend ?? getBackend();
  const local = saveShowroom(trimmed, panels, opts);
  if (!local.ok) return local;
  // Auto-migrate: when the daemon's list is empty AND the local store
  // has entries (just-saved one + any pre-existing legacy entries),
  // push them all up. This is a one-time hop per device.
  let migrated = 0;
  try {
    const daemonList = await daemon.listShowroomLayouts();
    if (daemonList.layouts.length === 0) {
      const localAll = readAll(backend);
      for (const layout of Object.values(localAll)) {
        try {
          await daemon.saveShowroomLayout(layout.name, {
            savedAt: layout.savedAt,
            panels: layout.panels,
            ...(layout.layoutMode ? { layoutMode: layout.layoutMode } : {}),
          });
          migrated += 1;
        } catch { /* skip individual failure */ }
      }
      return { ok: true, saved: local.saved, source: 'daemon', migrated };
    }
    // Normal save path — just upload this entry.
    await daemon.saveShowroomLayout(trimmed, {
      savedAt: local.saved.savedAt,
      panels: local.saved.panels,
      ...(local.saved.layoutMode ? { layoutMode: local.saved.layoutMode } : {}),
    });
    return { ok: true, saved: local.saved, source: 'daemon', migrated: 0 };
  } catch {
    // Daemon offline / network error — keep the local save (cache).
    return { ok: true, saved: local.saved, source: 'local', migrated: 0 };
  }
}

export async function deleteShowroomHybrid(
  name: string,
  daemon: DaemonLayoutClient,
  backend: StorageBackend = getBackend(),
): Promise<{ ok: boolean; source: 'daemon' | 'local' }> {
  const local = deleteSavedShowroom(name, backend);
  try {
    await daemon.deleteShowroomLayout(name);
    return { ok: true, source: 'daemon' };
  } catch {
    return { ok: local, source: 'local' };
  }
}

/** Reconstruct ShowroomPanel array from a saved layout — sessionId
 *  intentionally null so caller mounts fresh ACP handshake.
 *
 *  P5 — legacy entries (P5 이전 saved layout) 는 `kind` 만 있고
 *  `agentBrand` 없음. legacy entry 의 `kind === 'agent'` 가 보일 수
 *  없는 schema 였음 → migration 자동 (chat default · agentBrand 미존재
 *  필드 무시). */
export function panelsFromSaved(saved: SavedShowroomLayout): ShowroomPanel[] {
  return saved.panels.map((p) => ({
    id: p.id,
    kind: p.kind,
    provider: p.provider,
    ...(p.agentBrand ? { agentBrand: p.agentBrand } : {}),
    ...(p.roleHint ? { roleHint: p.roleHint } : {}),
    ...(p.personaId ? { personaId: p.personaId } : {}),
    sessionId: null,
    state: p.state,
  }));
}

/** Test seam — caller (P6 future test) can pass an in-memory backend. */
export function makeMemoryBackend(): StorageBackend {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}
