// W7 Z11.a-1 · DnD policy — when channels MUST stay silent.
// Cf. ROADMAP §4 Z11 S12 outbound · §6.7 finalize routing.

import type { OutboundChannelName, OutboundUrgency } from './types.js';

export interface DndWindow {
  /** Local 24h start hour (0-23). */
  startHour: number;
  /** Local 24h end hour (0-23). Wraps when endHour <= startHour. */
  endHour: number;
  /** Days of week the window applies (0=Sun ... 6=Sat). Empty = every day. */
  days?: number[];
  /** Channels muted within the window. Empty/omitted = all channels. */
  channels?: OutboundChannelName[];
  /** Urgency that pierces the window. Default 'critical' only. */
  pierceAt?: OutboundUrgency;
}

export interface DndPolicy {
  windows: DndWindow[];
  /** When set, the policy uses this clock instead of `new Date()`. */
  now?: () => Date;
}

const URGENCY_RANK: Record<OutboundUrgency, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

function inHourRange(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function isMuted(
  policy: DndPolicy,
  channel: OutboundChannelName,
  urgency: OutboundUrgency,
): boolean {
  const now = (policy.now ?? (() => new Date()))();
  const hour = now.getHours();
  const dow = now.getDay();
  for (const w of policy.windows) {
    const dayMatch = !w.days || w.days.length === 0 || w.days.includes(dow);
    const hourMatch = inHourRange(hour, w.startHour, w.endHour);
    const channelMatch = !w.channels || w.channels.length === 0 || w.channels.includes(channel);
    if (!dayMatch || !hourMatch || !channelMatch) continue;
    const pierce = w.pierceAt ?? 'critical';
    if (URGENCY_RANK[urgency] >= URGENCY_RANK[pierce]) continue;
    return true;
  }
  return false;
}
