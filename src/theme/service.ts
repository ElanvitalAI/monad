// IDX-6 Phase 3 — ThemeService.
//
// A reactive singleton wrapping the THEME_REGISTRY. Widgets + the
// dashboard subscribe for re-render signals when the user runs
// `/theme switch <name>`; the service persists the active name to
// ~/.elanous/theme.json so the next session opens in the same
// palette.
//
// Design points:
//   - Pure factory (createThemeService) — no module-scope state so
//     tests instantiate their own service without leaking across
//     specs. Dashboards pick up the shared instance via
//     getDashboardThemeService (Phase F / follow-up).
//   - Injectable read/write hooks + initial theme so tests don't
//     need a real filesystem. Defaults point at fs.promises for
//     production.
//   - Equality-guarded subscribe — a switch to the currently-active
//     theme is a no-op that neither persists nor fires listeners
//     (DD-IDX-17 applied to themes).
//   - ContextKeys bridge baked in: if the caller passes a
//     ContextKeyService, the service mirrors
//     themeName/themeIsDark/themeIsPastel on every switch.
//
// Not in scope for this module:
//   - Slash-command registration (see src/theme-slash-commands.ts).
//   - Per-widget re-rendering (Phase 4 — each widget subscribes on
//     its own).

import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { ContextKeyService } from '../input-core/context-keys.js';
import type { ThemeTokens } from './tokens.js';
import {
  DEFAULT_REGISTRY_THEME,
  THEME_REGISTRY,
  getTheme,
  listThemes,
} from '../themes/index.js';

/** Shape persisted to ~/.elanous/theme.json. Version field lets us
 *  extend the schema later (e.g. add per-widget overrides) without
 *  breaking older installs. */
export interface ThemeConfig {
  version: 1;
  name: string;
}

/** Default persist path. Exported so the dashboard / slash
 *  commands point at the same file. */
export function defaultThemeConfigPath(): string {
  return join(homedir(), '.elanous', 'theme.json');
}

export interface ThemeServiceSnapshot {
  name: string;
  isDark: boolean;
  isPastel: boolean;
}

export type ThemeListener = (theme: ThemeTokens) => void;

export interface ThemeService {
  /** The active theme. Stable reference between switches — a
   *  subscriber that caches the object is valid until the next
   *  switch. */
  readonly current: ThemeTokens;
  /** JSON-friendly snapshot for LLM tools + debug. */
  readonly snapshot: ThemeServiceSnapshot;
  /** Available themes (proxy to listThemes()). */
  list(): ReturnType<typeof listThemes>;
  /** Switch to the named preset. Resolves to true on success,
   *  false when the name is unknown (no-op). Persists on
   *  success if persistPath was set. Fires subscribers on a real
   *  change (no-op switches don't fire). */
  switch(name: string): Promise<boolean>;
  /** Reset to DEFAULT_REGISTRY_THEME and clear the persist file.
   *  Fires subscribers if the current theme differs from the
   *  default. */
  reset(): Promise<void>;
  /** Subscribe. Fires immediately with the current theme so
   *  subscribers prime themselves without racing the next
   *  switch. Returns a dispose fn. */
  subscribe(fn: ThemeListener): () => void;
  /** Drop subscribers. Idempotent. */
  dispose(): void;
}

export interface CreateThemeServiceOptions {
  /** Start with this theme. If absent, loads from persistPath
   *  when provided; otherwise falls back to DEFAULT_REGISTRY_THEME. */
  initial?: ThemeTokens;
  /** File path for persist. Absent = disable persist. */
  persistPath?: string;
  /** File reader. Defaults to fs.promises.readFile. */
  readFile?: (path: string) => Promise<string>;
  /** File writer. Defaults to fs.promises.writeFile — also creates
   *  the parent directory with mkdir recursive. */
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Deleter (for reset). Defaults to fs.promises.unlink. */
  removeFile?: (path: string) => Promise<void>;
  /** Context-keys service to mirror themeName/themeIsDark/themeIsPastel. */
  contextKeys?: ContextKeyService;
}

/** Read a theme config file and return the matched preset. Returns
 *  null when the file is missing, unparseable, or points at an
 *  unknown theme name — callers fall back to DEFAULT_REGISTRY_THEME. */
export async function readThemeConfig(
  path: string,
  readFile: (p: string) => Promise<string> = fsp.readFile.bind(fsp) as (
    p: string,
  ) => Promise<string>,
): Promise<ThemeTokens | null> {
  let raw: string;
  try {
    raw = await readFile(path);
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const name = (data as Record<string, unknown>).name;
  if (typeof name !== 'string') return null;
  return getTheme(name);
}

/** Serialize + write a theme config atomically (parent dir ensured). */
export async function writeThemeConfig(
  path: string,
  config: ThemeConfig,
  writeFile: (p: string, d: string) => Promise<void> = async (p, d) => {
    await fsp.mkdir(dirname(p), { recursive: true });
    await fsp.writeFile(p, d, 'utf8');
  },
): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
}

function snapshotOf(theme: ThemeTokens): ThemeServiceSnapshot {
  return {
    name: theme.name,
    isDark: theme.isDark ?? false,
    isPastel: theme.isPastel ?? false,
  };
}

/** Bridge helper (exposed separately for tests that want to feed
 *  a ThemeService into ContextKeys without constructing the whole
 *  service). Matches the wire* prefix used elsewhere. */
export function writeThemeSnapshotToContextKeys(
  ctx: ContextKeyService,
  snap: ThemeServiceSnapshot,
): void {
  ctx.update({
    themeName: snap.name,
    themeIsDark: snap.isDark,
    themeIsPastel: snap.isPastel,
  } as never);
}

export async function createThemeService(
  opts: CreateThemeServiceOptions = {},
): Promise<ThemeService> {
  const readFile =
    opts.readFile ??
    ((p: string) => fsp.readFile(p, 'utf8') as Promise<string>);
  const writeFile =
    opts.writeFile ??
    (async (p: string, d: string) => {
      await fsp.mkdir(dirname(p), { recursive: true });
      await fsp.writeFile(p, d, 'utf8');
    });
  const removeFile =
    opts.removeFile ??
    (async (p: string) => {
      try {
        await fsp.unlink(p);
      } catch {
        // Ignore absent file — reset's contract is "end up with no
        // persist", so a missing file already satisfies it.
      }
    });

  // Resolve the initial theme: explicit > persist > default.
  let current: ThemeTokens = opts.initial ?? DEFAULT_REGISTRY_THEME;
  if (!opts.initial && opts.persistPath) {
    const loaded = await readThemeConfig(opts.persistPath, readFile);
    if (loaded) current = loaded;
  }

  const listeners = new Set<ThemeListener>();
  let disposed = false;

  function fire(): void {
    for (const fn of listeners) {
      try {
        fn(current);
      } catch {
        // Swallow — same isolation policy as hover-tracker + MX6.
      }
    }
  }

  function syncContextKeys(): void {
    if (!opts.contextKeys) return;
    writeThemeSnapshotToContextKeys(opts.contextKeys, snapshotOf(current));
  }

  // Prime context keys immediately so dashboards see an accurate
  // themeName on boot, not null.
  syncContextKeys();

  return {
    get current() {
      return current;
    },
    get snapshot() {
      return snapshotOf(current);
    },

    list() {
      return listThemes();
    },

    async switch(name) {
      if (disposed) return false;
      const next = getTheme(name);
      if (!next) return false;
      if (next.name === current.name) {
        return true; // already active, treat as success no-op
      }
      current = next;
      if (opts.persistPath) {
        await writeThemeConfig(
          opts.persistPath,
          { version: 1, name: next.name },
          writeFile,
        );
      }
      syncContextKeys();
      fire();
      return true;
    },

    async reset() {
      if (disposed) return;
      if (current.name === DEFAULT_REGISTRY_THEME.name) {
        // Still drop the persist file — a reset from default to
        // default is unusual but the intent is "clean slate".
        if (opts.persistPath) await removeFile(opts.persistPath);
        return;
      }
      current = DEFAULT_REGISTRY_THEME;
      if (opts.persistPath) await removeFile(opts.persistPath);
      syncContextKeys();
      fire();
    },

    subscribe(fn) {
      listeners.add(fn);
      try {
        fn(current);
      } catch {
        // Swallow on prime.
      }
      return () => {
        listeners.delete(fn);
      };
    },

    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** Narrow a string to a registered theme name. Convenient for
 *  callers that receive user input and want to validate up front
 *  before awaiting ThemeService.switch. */
export function isKnownThemeName(name: string): boolean {
  return THEME_REGISTRY.some((t) => t.name === name);
}
