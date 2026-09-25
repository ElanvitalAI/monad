import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { US_PULSE_DB_PATH } from '../../domains/sector-store.js';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;

interface SurgeCriteria {
  minDays?: number;
  minDailyPct?: number;
}

interface Surge {
  symbol: string;
  days: number;
  cumulativePct: number;
}

const DEFAULT_CRITERIA: Required<SurgeCriteria> = { minDays: 2, minDailyPct: 2 };

/** Returns symbols whose latest consecutive daily gains each meet the configured threshold. */
export function listSurges(db: Database, criteria: SurgeCriteria = {}): Surge[] {
  const { minDays, minDailyPct } = { ...DEFAULT_CRITERIA, ...criteria };
  const rows = db.query(
    'SELECT symbol, close FROM bars ORDER BY symbol ASC, date ASC',
  ).all() as Array<{ symbol: string; close: number }>;
  const closesBySymbol = new Map<string, number[]>();
  for (const row of rows) {
    const closes = closesBySymbol.get(row.symbol) ?? [];
    closes.push(row.close);
    closesBySymbol.set(row.symbol, closes);
  }

  const surges: Surge[] = [];
  for (const [symbol, closes] of closesBySymbol) {
    let days = 0;
    for (let index = closes.length - 1; index > 0; index--) {
      const current = closes[index]!;
      const previous = closes[index - 1]!;
      if (current <= 0 || previous <= 0) break;
      const dailyPct = (current / previous - 1) * 100;
      if (dailyPct < minDailyPct) break;
      days++;
    }
    if (days >= minDays) {
      const base = closes[closes.length - days - 1]!;
      const cumulativePct = (closes[closes.length - 1]! / base - 1) * 100;
      surges.push({ symbol, days, cumulativePct });
    }
  }
  return surges.sort((left, right) => right.days - left.days || right.cumulativePct - left.cumulativePct || left.symbol.localeCompare(right.symbol));
}

type MarketSurgeCollection =
  | { available: true; surges: Surge[] }
  | { available: false; reason: string; repairHint: NonNullable<Extract<ProbeResult, { ok: false }>['repairHint']> };

function collectMarketSurgeCollection(criteria: SurgeCriteria, databasePath: string): MarketSurgeCollection {
  if (!existsSync(databasePath)) {
    return {
      available: false,
      reason: 'The US price-bars database file is unavailable.',
      repairHint: {
        paths: ['src/domains/sector-store.ts'],
        what: 'Restore the US price-bars database file used by the market data pipeline.',
      },
    };
  }
  const db = new Database(databasePath, { readonly: true });
  try {
    const hasBars = (db.query('SELECT EXISTS(SELECT 1 FROM bars) AS hasBars').get() as { hasBars: number }).hasBars === 1;
    if (!hasBars) {
      return {
        available: false,
        reason: 'The US price-bars database contains no bars.',
        repairHint: {
          paths: ['src/domains/sector-store.ts'],
          what: 'Restore collection of US price bars in the market data pipeline.',
        },
      };
    }
    return { available: true, surges: listSurges(db, criteria) };
  } finally {
    db.close();
  }
}

/** Read-only production collector; tests inject an in-memory collector instead. */
export function collectMarketSurges(criteria: SurgeCriteria = {}, databasePath = US_PULSE_DB_PATH): Surge[] {
  const collection = collectMarketSurgeCollection(criteria, databasePath);
  return collection.available ? collection.surges : [];
}

export function probeMarketSurgeList(
  collectSurges?: (criteria?: SurgeCriteria) => Surge[],
  criteria: SurgeCriteria = {},
  databasePath = US_PULSE_DB_PATH,
): ProbeResult {
  if (collectSurges) {
    collectSurges(criteria);
    return { ok: true };
  }
  const collection = collectMarketSurgeCollection(criteria, databasePath);
  if (collection.available) return { ok: true };
  return { ok: false, reason: collection.reason, repairHint: collection.repairHint };
}

export function createMarketSurgeListProvider(
  collectSurges: (criteria?: SurgeCriteria) => Surge[] = collectMarketSurges,
  criteria: SurgeCriteria = {},
): CapabilityProvider {
  return {
    id: 'market.surge.list',
    async probe(): Promise<ProbeResult> {
      return probeMarketSurgeList(collectSurges === collectMarketSurges ? undefined : collectSurges, criteria);
    },
  };
}

// scripts/mission-request-judge.ts resolves market.surge.list to this exact filename.
export default createMarketSurgeListProvider();
