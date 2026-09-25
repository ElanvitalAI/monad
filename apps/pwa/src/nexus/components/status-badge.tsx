// PWA · NEXUS tab status badge (Phase N-4 PR ο)
//
// Mirrors the TUI sidebar badge symbols (●/○/△/↻/✕/⚠) with PWA-friendly
// Tailwind colors. Pure component — no hooks, no client wiring.

import type { NexusTabStatus } from '../types';

export const STATUS_BADGE_GLYPH: Record<NexusTabStatus, string> = {
  idle: '○',
  starting: '↻',
  active: '●',
  unhealthy: '△',
  restarting: '↻',
  crashed: '✕',
  stopped: '○',
  external: '⚠',
};

export const STATUS_BADGE_TONE: Record<NexusTabStatus, string> = {
  idle: 'text-muted-foreground',
  starting: 'text-blue-500 animate-pulse',
  active: 'text-emerald-500',
  unhealthy: 'text-amber-500',
  restarting: 'text-blue-500 animate-spin',
  crashed: 'text-rose-500',
  stopped: 'text-muted-foreground',
  external: 'text-purple-500',
};

export const STATUS_BADGE_LABEL: Record<NexusTabStatus, string> = {
  idle: 'Idle',
  starting: 'Starting…',
  active: 'Active',
  unhealthy: 'Unhealthy',
  restarting: 'Restarting…',
  crashed: 'Crashed',
  stopped: 'Stopped',
  external: 'External',
};

export interface StatusBadgeProps {
  status: NexusTabStatus;
  label?: boolean; // when true, render text label after the glyph
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const glyph = STATUS_BADGE_GLYPH[status];
  const tone = STATUS_BADGE_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1 ${tone} ${className ?? ''}`} title={STATUS_BADGE_LABEL[status]}>
      <span aria-hidden="true">{glyph}</span>
      {label && <span className="text-xs">{STATUS_BADGE_LABEL[status]}</span>}
    </span>
  );
}
