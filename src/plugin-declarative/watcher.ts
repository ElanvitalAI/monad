// ── PX-7 P4: fs.watch with debounce ──
//
// Watches 6 kind directories × (user, project) = up to 12 watches.
// Change events coalesce inside a 5s debounce window so editor
// autosave bursts reload once. `dispose()` closes all watches + clears
// the debounce timer.
//
// Non-recursive on purpose — missions live under <kind>/<id>/mission.md
// so we watch each mission subdirectory explicitly when it appears.
// A single onChange callback fires per coalesce window with a
// summary of the triggering events.

import { watch, existsSync, statSync, readdirSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import {
  DECLARATIVE_KINDS,
  type DeclarativeKind,
  type DeclarativeSources,
} from './discovery.js';

export const WATCHER_DEFAULT_DEBOUNCE_MS = 5_000;

export interface WatcherOpts {
  sources: DeclarativeSources;
  onChange: (reason: string) => void | Promise<void>;
  debounceMs?: number;
  ignoreMissionSubdirs?: boolean;   // testing seam
}

export interface WatcherHandle {
  dispose(): void;
  state(): { watching: number; pending: boolean };
}

export function startDeclarativeWatcher(opts: WatcherOpts): WatcherHandle {
  const debounceMs = opts.debounceMs ?? WATCHER_DEFAULT_DEBOUNCE_MS;
  const watchers: FSWatcher[] = [];
  const events: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = (reason: string) => {
    if (disposed) return;
    if (shouldIgnoreEventPath(reason)) return;
    events.push(reason);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (disposed) return;
      const summary = events.length === 1
        ? events[0]!
        : `bulk (${events.length} events, first: ${events[0]})`;
      events.length = 0;
      debounceTimer = null;
      void opts.onChange(summary);
    }, debounceMs);
  };

  const watchKindDir = (root: string, kind: DeclarativeKind) => {
    const dir = join(root, kind);
    if (!existsSync(dir)) return;
    try {
      const w = watch(dir, (_event, file) => {
        fire(`${kind}:${file ?? '?'}`);
        // If a mission subdirectory appears, attach a watcher to it
        // so mission.md edits trigger reloads. Non-recursive parent
        // watch only catches the subdir creation, not its contents.
        if (kind === 'missions' && file && !opts.ignoreMissionSubdirs) {
          const sub = join(dir, file);
          try {
            if (existsSync(sub) && statSync(sub).isDirectory()) {
              watchMissionSubdir(sub);
            }
          } catch { /* ignore */ }
        }
      });
      watchers.push(w);
    } catch { /* ignore unsupported platforms */ }
  };

  const watchMissionSubdir = (sub: string) => {
    try {
      const w = watch(sub, (_event, file) => {
        fire(`missions:${sub.split('/').pop()}/${file ?? '?'}`);
      });
      watchers.push(w);
    } catch { /* ignore */ }
  };

  // Initial watches.
  const roots = [opts.sources.user, ...(opts.sources.project ? [opts.sources.project] : [])];
  for (const root of roots) {
    for (const kind of DECLARATIVE_KINDS) {
      watchKindDir(root, kind);
    }
    // Pre-attach watchers for existing mission subdirs.
    if (!opts.ignoreMissionSubdirs) {
      const missionsDir = join(root, 'missions');
      if (existsSync(missionsDir)) {
        for (const entry of readdirSync(missionsDir)) {
          const sub = join(missionsDir, entry);
          try {
            if (statSync(sub).isDirectory()) watchMissionSubdir(sub);
          } catch { /* ignore */ }
        }
      }
    }
  }

  return {
    dispose(): void {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      watchers.length = 0;
    },
    state(): { watching: number; pending: boolean } {
      return {
        watching: watchers.length,
        pending: events.length > 0 || debounceTimer !== null,
      };
    },
  };
}

function shouldIgnoreEventPath(reason: string): boolean {
  // Skip hidden / underscore / non-markdown files — fs.watch's raw
  // `file` arg is only the basename, so split the "kind:..." prefix.
  const colon = reason.indexOf(':');
  if (colon === -1) return false;
  const tail = reason.slice(colon + 1);
  const base = tail.split('/').pop()!;
  if (!base || base === '?') return false;
  if (base.startsWith('.') || base.startsWith('_')) return true;
  // catalog.json writes also land here — ignore those.
  if (base === 'catalog.json') return true;
  return false;
}
