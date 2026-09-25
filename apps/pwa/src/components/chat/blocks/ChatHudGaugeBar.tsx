// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M4 — inline progress
// bar for context-fill gauges (key='token-gauge' / 'ctx'). Single
// visual primitive promoted out of the line-strip into a horizontal
// pill that the user can scan at a glance — matches the Claude Code
// status-line reference image (§3.3).
//
// Percentage extraction: lifts the first integer it sees from the
// segment value (e.g. '87%', '87% (690k/1000k)', 'ctx 87%') and clamps
// 0-100. Renders the original value text alongside the bar so the
// extra detail ('(690k/1000k)') is not lost.
//
// Color ramp (matches PLAN §3.3 design intent):
//  - 0-60%  emerald (calm · headroom)
//  - 60-80% amber  (warn · approaching)
//  - 80+%   pink   (danger · imminent)

'use client';

import { cn } from '@/lib/utils';

interface ChatHudGaugeBarProps {
  /** Stable segment key for test selectors + React key. */
  segmentKey: string;
  /** Original segment value text. Rendered to the right of the bar. */
  value: string;
  /** Optional leading glyph (emoji or single-char). */
  glyph?: string;
}

function extractPercent(value: string): number | null {
  const match = /(\d{1,3})\s*%/.exec(value);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function ratioToToneClasses(ratio: number): { bar: string; text: string } {
  if (ratio >= 80) return { bar: 'bg-pink-400', text: 'text-pink-300' };
  if (ratio >= 60) return { bar: 'bg-amber-400', text: 'text-amber-300' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-300' };
}

export function ChatHudGaugeBar({ segmentKey, value, glyph }: ChatHudGaugeBarProps) {
  const percent = extractPercent(value);
  // Fallback: not a percent-bearing value — render as plain text chip
  // so the strip stays visually consistent.
  if (percent === null) {
    return (
      <span
        data-monad-hud-key={segmentKey}
        data-monad-hud-gauge="false"
        className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground"
      >
        {glyph ? <span aria-hidden="true">{glyph}</span> : null}
        <span>{value}</span>
      </span>
    );
  }
  const { bar, text } = ratioToToneClasses(percent);
  return (
    <span
      data-monad-hud-key={segmentKey}
      data-monad-hud-gauge="true"
      data-monad-hud-percent={String(percent)}
      className="inline-flex items-center gap-1.5 font-mono text-[11px]"
    >
      {glyph ? (
        <span aria-hidden="true" className="text-muted-foreground">
          {glyph}
        </span>
      ) : null}
      <span
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${segmentKey} ${percent}%`}
        className="relative h-2 w-20 overflow-hidden rounded bg-muted/30"
      >
        <span
          aria-hidden="true"
          style={{ width: `${percent}%` }}
          className={cn('block h-full', bar)}
        />
      </span>
      <span className={cn('tabular-nums', text)}>{value}</span>
    </span>
  );
}
