// ── Wave 6 · /cost slash ──────────────────────────────────────────
//
// Reads the persistent JSONL cost log (cost-meter.ts) and shows
// total / weekly / monthly USD + per-model breakdown. Cap status
// comes from the user's cost-config (already persisted by the
// existing cost-meter pipeline).

import {
  loadCostConfig,
  monthlyCapStatus,
  snapshotCost,
  weeklyCapStatus,
} from '../intelligence-map/cost-meter.js';
import type { CostSnapshot } from '../intelligence-map/types.js';
import { formatNumber } from './format.js';

export interface CostSlashCommandDescriptor {
  name: string;
  aliases: string[];
  description: string;
  render(snapshot?: CostSnapshot): string;
}

export function buildCostSlashCommand(): CostSlashCommandDescriptor {
  return {
    name: 'cost',
    aliases: ['budget', 'spend'],
    description:
      'Show total / weekly / monthly USD spend + per-model breakdown + cap status.',
    render(snapshot?: CostSnapshot): string {
      try {
        const snap = snapshot ?? snapshotCost();
        const config = loadCostConfig();
        return formatCostSummary(snap, config);
      } catch (err) {
        return `── /cost ────────────────────────────────────────────────\n(cost log unavailable: ${(err as Error).message})`;
      }
    },
  };
}

export function formatCostSummary(
  snap: CostSnapshot,
  config: { weeklyCapUsd?: number; monthlyCapUsd?: number },
): string {
  const lines: string[] = [];
  lines.push('── /cost ────────────────────────────────────────────────');
  lines.push(`Total spend:   $${snap.totalUsd.toFixed(4)}  (${snap.eventsCount} call(s) tracked)`);
  lines.push(`Weekly:        $${snap.weeklyUsd.toFixed(4)}${config.weeklyCapUsd !== undefined ? `  (cap $${config.weeklyCapUsd.toFixed(2)} · ${weeklyCapStatus(snap, config)})` : ''}`);
  lines.push(`Monthly:       $${snap.monthlyUsd.toFixed(4)}${config.monthlyCapUsd !== undefined ? `  (cap $${config.monthlyCapUsd.toFixed(2)} · ${monthlyCapStatus(snap, config)})` : ''}`);

  const perModelKeys = Object.keys(snap.perModel).sort(
    (a, b) => snap.perModel[b]!.usd - snap.perModel[a]!.usd,
  );
  if (perModelKeys.length > 0) {
    lines.push('');
    lines.push('Per model (sorted by spend):');
    for (const model of perModelKeys.slice(0, 12)) {
      const b = snap.perModel[model]!;
      lines.push(`  ${model.padEnd(28)} $${b.usd.toFixed(4).padStart(9)}  · ${b.count.toString().padStart(3)}×  · ${formatNumber(b.tokens)} tok`);
    }
    if (perModelKeys.length > 12) {
      lines.push(`  ... and ${perModelKeys.length - 12} more model(s)`);
    }
  }

  const perGoalKeys = Object.keys(snap.perGoal).sort();
  if (perGoalKeys.length > 0) {
    lines.push('');
    lines.push('Per goal:');
    for (const goal of perGoalKeys) {
      const b = snap.perGoal[goal]!;
      lines.push(`  ${goal.padEnd(28)} $${b.usd.toFixed(4).padStart(9)}  · ${formatNumber(b.tokens)} tok`);
    }
  }

  return lines.join('\n');
}
