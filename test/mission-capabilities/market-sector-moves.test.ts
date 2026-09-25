import { describe, expect, spyOn, test } from 'bun:test';
import { openSectorDb, readSectorScores, saveSectorScores } from '../../src/domains/sector-store.js';
import type { SectorScore } from '../../src/domains/sector-attractiveness.js';
import provider, {
  createSectorMovesProvider,
  probeSectorMoves,
  readStoredSectorScores,
} from '../../src/mission-capabilities/market/sector.moves.js';
import { capabilityProviders, probeCapability } from '../../src/mission-capabilities/registry.js';

const weeklyUsScore: SectorScore = {
  market: 'US', window: 'weekly', chain: 'Technology', mom: 1.2, breadth: 80, score: 1.5, n: 4, rank: 1,
};

describe('market.sector.moves capability provider', () => {
  test('exports the market.sector.moves provider', () => {
    expect(provider.id).toBe('market.sector.moves');
  });

  test('reports a repairable failure when sector_scores is empty', () => {
    const db = openSectorDb(':memory:');
    try {
      const result = probeSectorMoves(() => readSectorScores(db, 'KR', 'daily'));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected empty sector_scores to degrade the provider.');
      expect(result.reason).toContain('stored sector scores');
      expect(result.repairHint.paths).toContain('src/domains/sector-store.ts');
    } finally {
      db.close();
    }
  });

  test('reports ready after scores are stored and provider delegates to its reader', async () => {
    const db = openSectorDb(':memory:');
    try {
      saveSectorScores(db, '2026-08-31', [weeklyUsScore]);
      let calls = 0;
      const sectorProvider = createSectorMovesProvider(() => {
        calls += 1;
        return readSectorScores(db, 'US', 'weekly');
      });

      expect(sectorProvider.id).toBe('market.sector.moves');
      expect(await sectorProvider.probe()).toEqual({ ok: true });
      expect(calls).toBe(1);
    } finally {
      db.close();
    }
  });

  test('changes its result for real empty and seeded in-memory sector stores', () => {
    const emptyDb = openSectorDb(':memory:');
    const seededDb = openSectorDb(':memory:');
    try {
      saveSectorScores(seededDb, '2026-08-31', [weeklyUsScore]);
      const empty = probeSectorMoves(() => readSectorScores(emptyDb, 'KR', 'daily'));
      const seeded = probeSectorMoves(() => readSectorScores(seededDb, 'US', 'weekly'));

      expect(empty.ok).toBe(false);
      expect(seeded.ok).toBe(true);
      expect(seeded.ok).not.toBe(empty.ok);
    } finally {
      emptyDb.close();
      seededDb.close();
    }
  });

  test('default stored-score reader finds non-daily scores through the real sector store', () => {
    const firstDb = openSectorDb(':memory:');
    saveSectorScores(firstDb, '2026-08-31', [weeklyUsScore]);
    expect(readStoredSectorScores(() => firstDb)).toEqual([weeklyUsScore]);

    const secondDb = openSectorDb(':memory:');
    saveSectorScores(secondDb, '2026-08-31', [weeklyUsScore]);
    expect(probeSectorMoves(() => readStoredSectorScores(() => secondDb)).ok).toBe(true);
  });

  test('probeCapability delegates to the registered market.sector.moves provider', async () => {
    const registered = capabilityProviders.find(candidate => candidate.id === 'market.sector.moves');
    if (!registered) throw new Error('레지스트리에 market.sector.moves 가 «없다».');

    const sentinel = { ok: false, reason: 'sentinel', repairHint: { paths: ['sentinel'], what: 'sentinel' } } as const;
    const spy = spyOn(registered, 'probe').mockResolvedValue(sentinel);
    try {
      expect(await probeCapability('market.sector.moves')).toEqual(sentinel);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
