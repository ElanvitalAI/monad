// ── Wave 6 · /usage slash ──────────────────────────────────────────
//
// Per-role / per-provider matrix view, mirroring Gemini's
// ModelStatsDisplay. Reads from the in-memory telemetry buffer
// populated by the chat surface (Wave 1).

import { getSessionStats, type SessionStats } from './telemetry.js';
import { formatNumber } from './format.js';

export interface UsageSlashCommandDescriptor {
  name: string;
  aliases: string[];
  description: string;
  render(): string;
}

export function buildUsageSlashCommand(): UsageSlashCommandDescriptor {
  return {
    name: 'usage',
    aliases: ['stats'],
    description:
      'Show per-provider / per-model / per-role token usage matrix for this session.',
    render(): string {
      return formatUsageSummary(getSessionStats());
    },
  };
}

export function formatUsageSummary(session: SessionStats): string {
  const lines: string[] = [];
  lines.push('── /usage ───────────────────────────────────────────────');
  if (session.callCount === 0) {
    lines.push('(no LLM calls captured this session)');
    return lines.join('\n');
  }
  lines.push(`Total: ${session.callCount} call(s)`);
  lines.push(`  in: ${formatNumber(session.totalInput)}  out: ${formatNumber(session.totalOutput)}  cache-r: ${formatNumber(session.totalCacheRead)}  cache-w: ${formatNumber(session.totalCacheCreate)}  reasoning: ${formatNumber(session.totalReasoning)}`);

  lines.push('');
  lines.push('Per provider:');
  for (const provider of Object.keys(session.perProvider).sort()) {
    const b = session.perProvider[provider]!;
    lines.push(`  ${provider.padEnd(14)} ${b.callCount.toString().padStart(3)}× · in ${formatNumber(b.totalInput).padStart(8)} · out ${formatNumber(b.totalOutput).padStart(7)}`);
  }

  lines.push('');
  lines.push('Per model:');
  for (const model of Object.keys(session.perModel).sort()) {
    const b = session.perModel[model]!;
    lines.push(`  ${model.padEnd(28)} ${b.callCount.toString().padStart(3)}× · in ${formatNumber(b.totalInput).padStart(8)} · out ${formatNumber(b.totalOutput).padStart(7)}`);
  }

  if (Object.keys(session.perRole).length > 1) {
    lines.push('');
    lines.push('Per role:');
    for (const role of Object.keys(session.perRole).sort()) {
      const b = session.perRole[role]!;
      lines.push(`  ${role.padEnd(14)} ${b.callCount.toString().padStart(3)}× · in ${formatNumber(b.totalInput).padStart(8)} · out ${formatNumber(b.totalOutput).padStart(7)}`);
    }
  }

  return lines.join('\n');
}
