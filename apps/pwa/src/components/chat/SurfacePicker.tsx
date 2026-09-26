'use client';

/**
 * PR-D (PWA surface picker · 2026-05-13) — compact cycle button that
 * lets the chat client opt into a per-request tool surface
 * (`readonly` · `chat` · `webterm` · default).
 *
 * UI shape: a single pill that shows the current surface label +
 * colored dot. Each click rotates to the next option in the 4-tier
 * cycle (default → readonly → chat → webterm → default). The
 * compact form trades discoverability of the alternatives for a
 * small header footprint — `title` carries the next-target hint so
 * hovering reveals the cycle without taking screen space.
 *
 * The 4-tier set:
 *   - `default` (null preference) — no override; daemon's `--tools`
 *     CLI / `global.tools` config wins.
 *   - `readonly` — Read · Grep · WebSearch · Plan · MarkStepDone.
 *   - `chat` — readonly + Edit + Bash. No PTY / WebTerminal tools.
 *   - `webterm` — chat + WebTerminal* (REPL · TUI · watchers).
 *
 * Mounted in ChatLayout.tsx's header next to <ProviderPicker>.
 * Per-tab state lives in `localStorage` via `surface-preference.ts`.
 */

import { useEffect, useState } from 'react';

import type { DaemonToolSurfaceKind } from '@/lib/daemon-client';
import {
  getSurfacePreference,
  setSurfacePreference,
  subscribeSurfacePreference,
  type SurfacePreference,
} from '@/lib/surface-preference';
import { cn } from '@/lib/utils';

interface SurfaceOption {
  value: SurfacePreference;
  label: string;
  description: string;
  /** Tailwind class for the colored dot — kept simple so it tracks
   *  dark/light mode via the theme tokens. */
  dotClass: string;
  /** Tailwind class applied to the button when this option is active.
   *  Tints the border + label so the surface choice reads at a glance
   *  even without looking at the dot. */
  buttonClass: string;
}

const OPTIONS: readonly SurfaceOption[] = [
  {
    value: null,
    label: 'default',
    description: 'Use the daemon\'s configured surface (no per-turn override).',
    dotClass: 'bg-muted-foreground/60',
    buttonClass: 'border-border text-muted-foreground hover:bg-muted/60',
  },
  {
    value: 'readonly',
    label: 'readonly',
    description: 'Read · Grep · WebSearch · Plan only — no edits, no shell.',
    dotClass: 'bg-emerald-500',
    buttonClass: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
  },
  {
    value: 'chat',
    label: 'chat',
    description: 'readonly + Edit + Bash. No PTY / WebTerminal tools.',
    dotClass: 'bg-sky-500',
    buttonClass: 'border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10',
  },
  {
    value: 'webterm',
    label: 'webterm',
    description: 'chat + WebTerminal* (List · Snapshot · Input · Screenshot).',
    dotClass: 'bg-amber-500',
    buttonClass: 'border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10',
  },
];

function findOptionIndex(value: SurfacePreference): number {
  const idx = OPTIONS.findIndex((o) => o.value === value);
  return idx === -1 ? 0 : idx;
}

/** Read the current preference from localStorage on mount and stay in
 *  sync with cross-tab updates. Returns `[value, set]` so callers
 *  outside the picker (e.g., ChatLayout's per-turn `tools` inject)
 *  can read the same source. */
export function useSurfacePreference(): [
  SurfacePreference,
  (value: SurfacePreference) => void,
] {
  const [value, setValue] = useState<SurfacePreference>(() => getSurfacePreference());
  useEffect(() => {
    setValue(getSurfacePreference());
    return subscribeSurfacePreference((next) => setValue(next));
  }, []);
  const apply = (next: SurfacePreference): void => {
    setSurfacePreference(next);
    setValue(next);
  };
  return [value, apply];
}

/** Resolve the active preference to the wire-level value forwarded
 *  on `/v1/prompt/stream`. `null` means "send no tools field" so the
 *  daemon's configured surface stays in effect. Centralised so the
 *  ChatLayout call site doesn't re-derive. */
export function surfacePreferenceToWire(
  value: SurfacePreference,
): DaemonToolSurfaceKind | undefined {
  return value ?? undefined;
}

/** Compute the next preference in the cycle. Exported so unit tests
 *  can lock the rotation order without re-creating the OPTIONS array.
 *  Unknown values fall back to OPTIONS[0] (default) which is also the
 *  recovery path when stale localStorage entries get coerced to
 *  null by `getSurfacePreference()`. */
export function nextSurfacePreference(current: SurfacePreference): SurfacePreference {
  const idx = findOptionIndex(current);
  const nextIdx = (idx + 1) % OPTIONS.length;
  return OPTIONS[nextIdx]!.value;
}

export function SurfacePicker() {
  const [selected, setSelected] = useSurfacePreference();
  const current = OPTIONS[findOptionIndex(selected)]!;
  const next = OPTIONS[(findOptionIndex(selected) + 1) % OPTIONS.length]!;
  return (
    <button
      type="button"
      data-elanous-surface-picker=""
      data-elanous-surface-current={current.value ?? 'default'}
      aria-label={`Daemon tool surface: ${current.label} (click to switch to ${next.label})`}
      title={`${current.label} — ${current.description}\nClick to switch to ${next.label}.`}
      onClick={() => setSelected(nextSurfacePreference(selected))}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
        current.buttonClass,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', current.dotClass)} aria-hidden />
      <span>{current.label}</span>
    </button>
  );
}
