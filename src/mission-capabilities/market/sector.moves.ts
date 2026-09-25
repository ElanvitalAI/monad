import { Database, type Database as SqliteDatabase } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { SCREENER_DB_PATH, openSectorDb, readSectorScores } from '../../domains/sector-store.js';
import type { SectorScore, SectorMarket, SectorWindow } from '../../domains/sector-attractiveness.js';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

type ProbeResult = CapabilityProbeResult;
type SectorScoreReader = () => SectorScore[];
type SectorDbOpener = () => SqliteDatabase;

const markets: readonly SectorMarket[] = ['KR', 'US'];
const windows: readonly SectorWindow[] = ['daily', 'weekly', 'monthly'];

export function readStoredSectorScores(openDb: SectorDbOpener = openSectorDb): SectorScore[] {
  const db = openDb();
  try {
    return markets.flatMap(market => windows.flatMap(window => readSectorScores(db, market, window)));
  } finally {
    db.close();
  }
}

export function readConfiguredSectorScores(): SectorScore[] {
  if (!existsSync(SCREENER_DB_PATH)) return [];
  try {
    return readStoredSectorScores(() => new Database(SCREENER_DB_PATH, { readonly: true }));
  } catch {
    return [];
  }
}

export function probeSectorMoves(readScores: SectorScoreReader = readStoredSectorScores): ProbeResult {
  if (readScores().length > 0) return { ok: true };

  return {
    ok: false,
    reason: 'No stored sector scores are available.',
    repairHint: {
      paths: ['src/domains/sector-store.ts'],
      what: 'Compute and store sector scores before requesting sector-move analysis.',
    },
  };
}

export function createSectorMovesProvider(readScores: SectorScoreReader = readStoredSectorScores): CapabilityProvider {
  return {
    id: 'market.sector.moves',
    async probe(): Promise<ProbeResult> {
      return probeSectorMoves(readScores === readStoredSectorScores ? readConfiguredSectorScores : readScores);
    },
  };
}

export default createSectorMovesProvider();
