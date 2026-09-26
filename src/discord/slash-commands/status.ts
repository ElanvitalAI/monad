// Slash command: /status
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.2)
//
// Returns a quick elanous status summary in this channel — uptime,
// active personas, lane count, optional cost. Caller injects the
// snapshot via ctx.

import {
  RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
  type BoundSlashCommand, type SlashCommandSchema, type SlashHandler,
} from '../slash-types.js';

export const STATUS_SCHEMA: SlashCommandSchema = {
  name: 'status',
  description: 'Show elanous runtime status (uptime, personas, lanes)',
  dmPermission: true,
};

export interface ElanousStatusSnapshot {
  readonly uptimeSeconds: number;
  readonly personaCount: number;
  readonly activeLaneCount: number;
  readonly version?: string;
  /** Sprint 25+ G8 budget tracking. Undefined = unset. */
  readonly costSummary?: {
    readonly monthSpendUsd: number;
    readonly monthBudgetUsd?: number;
  };
}

export interface StatusCtx {
  readonly snapshot: () => Promise<ElanousStatusSnapshot> | ElanousStatusSnapshot;
}

export const statusHandler: SlashHandler<StatusCtx> = async (_interaction, ctx) => {
  const s = await ctx.snapshot();
  const lines: string[] = [
    `**uptime** ${formatDuration(s.uptimeSeconds)}`,
    `**personas** ${s.personaCount} registered`,
    `**lanes** ${s.activeLaneCount} active`,
  ];
  if (s.version) lines.push(`**version** \`${s.version}\``);
  if (s.costSummary) {
    const c = s.costSummary;
    const tail = c.monthBudgetUsd !== undefined
      ? ` / $${c.monthBudgetUsd.toFixed(2)}`
      : '';
    lines.push(`**cost (mtd)** $${c.monthSpendUsd.toFixed(4)}${tail}`);
  }
  return {
    type: RESPONSE_CHANNEL_MESSAGE_WITH_SOURCE,
    content: `📊 elanous status\n${lines.join('\n')}`,
    ephemeral: true,
  };
};

export const statusCommand: BoundSlashCommand<StatusCtx> = {
  schema: STATUS_SCHEMA,
  handler: statusHandler,
};

/** Compact duration — e.g. '3h 12m', '5m 02s', '12s'. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${String(h % 24).padStart(2, '0')}h`;
}
