// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M4 — PWA HUD strip
// renderer. Subscribes to chat-runtime's process-wide HUD state and
// renders the segments as a 2-line CSS grid (top: turn-relevant ·
// bottom: session/system) matching the Claude Code status-line
// reference (§3.3). Visual default = Option B (rich · gauge bar).
//
// Empty-state contract: when no segments are present, the component
// renders nothing — the strip should not occupy vertical space when
// the daemon hasn't pushed anything yet.

'use client';

import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';
import type { HudSegmentPayload, HudTone } from '@/lib/feedback-block-accumulator';
import {
  getHudSegmentsSnapshot,
  subscribeHudSegments,
} from '@/lib/chat-runtime';
import { ChatHudGaugeBar } from './ChatHudGaugeBar';

const TOP_ROW_KEYS: ReadonlySet<string> = new Set([
  'variant',
  'workspace',
  'model',
  'token-gauge',
  'ctx',
  'agent-activity',
  'agents',
]);

const GAUGE_KEYS: ReadonlySet<string> = new Set(['token-gauge', 'ctx']);

const TONE_CLASSES: Record<HudTone, string> = {
  normal: 'text-foreground',
  warn: 'text-amber-300',
  danger: 'text-pink-300',
  success: 'text-emerald-300',
  info: 'text-sky-300',
  muted: 'text-muted-foreground',
};

function partition(segments: HudSegmentPayload[]): {
  top: HudSegmentPayload[];
  bottom: HudSegmentPayload[];
} {
  const top: HudSegmentPayload[] = [];
  const bottom: HudSegmentPayload[] = [];
  for (const s of segments) {
    if (TOP_ROW_KEYS.has(s.key)) top.push(s);
    else bottom.push(s);
  }
  return { top, bottom };
}

function HudSegmentChip({ segment }: { segment: HudSegmentPayload }) {
  if (GAUGE_KEYS.has(segment.key)) {
    return (
      <ChatHudGaugeBar
        segmentKey={segment.key}
        value={segment.value}
        {...(segment.glyph !== undefined ? { glyph: segment.glyph } : {})}
      />
    );
  }
  const toneClass = segment.tone ? TONE_CLASSES[segment.tone] : TONE_CLASSES.normal;
  return (
    <span
      data-monad-hud-key={segment.key}
      data-monad-hud-tone={segment.tone ?? 'normal'}
      data-monad-hud-priority={String(segment.priority ?? 50)}
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px]',
        toneClass,
      )}
    >
      {segment.glyph ? <span aria-hidden="true">{segment.glyph}</span> : null}
      <span>{segment.value}</span>
    </span>
  );
}

function HudRow({
  segments,
  row,
  className,
}: {
  segments: HudSegmentPayload[];
  row: 'top' | 'bottom';
  className?: string;
}) {
  if (segments.length === 0) return null;
  return (
    <div
      data-monad-hud-row={row}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1',
        className,
      )}
    >
      {segments.map((seg, i) => (
        <span
          key={seg.key}
          className="flex items-center gap-x-3"
        >
          {i > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
          ) : null}
          <HudSegmentChip segment={seg} />
        </span>
      ))}
    </div>
  );
}

/** Pure presentation. Tests target this directly via SSR markup so
 *  the snapshot path doesn't depend on `useSyncExternalStore`'s SSR
 *  semantics (server snapshot is mandatory empty for hydration
 *  determinism). */
export function ChatHudView({ segments }: { segments: HudSegmentPayload[] }) {
  if (segments.length === 0) return null;
  const { top, bottom } = partition(segments);
  return (
    <div
      data-monad-hud="strip"
      role="status"
      aria-label="HUD status"
      className="flex flex-col gap-0.5 border-b border-border/40 bg-muted/10 px-3 py-1.5"
    >
      <HudRow segments={top} row="top" />
      {/* Bottom row hidden on narrow viewports — keeps mobile chat
          height tight while preserving the high-info top row. */}
      <HudRow
        segments={bottom}
        row="bottom"
        className="hidden sm:flex"
      />
    </div>
  );
}

const EMPTY_SNAPSHOT: HudSegmentPayload[] = [];

/** SSR snapshot must be deterministic across server + first client
 *  paint (hydration safety). HUD writes always arrive after hydration
 *  via the M4 SSE subscriber, so empty is the correct initial state. */
function getServerSnapshot(): HudSegmentPayload[] {
  return EMPTY_SNAPSHOT;
}

/** Mount once in ChatLayout's header. Subscribes to the chat-runtime
 *  hud store via useSyncExternalStore for tear-free reads. The strip
 *  renders nothing when the store is empty (the M2 SSE may not have
 *  delivered the first segment yet, or daemon is in TUI-only mode). */
export function ChatHud() {
  const segments = useSyncExternalStore(
    subscribeHudSegments,
    getHudSegmentsSnapshot,
    getServerSnapshot,
  );
  return <ChatHudView segments={segments} />;
}
