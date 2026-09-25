import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CapabilityProbeResult, CapabilityProvider } from '../registry.js';

const X_ASSET_DB = join(homedir(), '.claude/skills/apify-x-asset-sentiment/data/x_asset.db');
const REQUIRED_INSTRUMENTS = [
  { symbol: '^GSPC', region: 'US' },
  { symbol: '^IXIC', region: 'US' },
  { symbol: 'EWY', region: 'KR' },
  { symbol: 'EWJ', region: 'JP' },
  { symbol: 'FXI', region: 'CN' },
] as const;

type ProbeResult = CapabilityProbeResult;
type CoverageReader = () => readonly string[];

export interface MarketIndexMove {
  symbol: string;
  region: string;
  date: string;
  close: number;
  return1d: number | null;
}

export function readMarketQuoteCoverage(db: Database): readonly string[] {
  const symbols = REQUIRED_INSTRUMENTS.map(({ symbol }) => symbol);
  const placeholders = symbols.map(() => '?').join(', ');
  const rows = db.query<{ symbol: string; region_key: string; close: number | null; return1d: number | null }, string[]>(`
    SELECT instrument.symbol, instrument.region_key, daily.px_close AS close, daily.ret_1d AS return1d
    FROM fact_market_daily AS daily
    JOIN dim_instrument AS instrument ON instrument.instrument_id = daily.instrument_id
    JOIN (
      SELECT instrument_id, MAX(date) AS date
      FROM fact_market_daily
      GROUP BY instrument_id
    ) AS latest ON latest.instrument_id = daily.instrument_id AND latest.date = daily.date
    WHERE instrument.symbol IN (${placeholders})
      AND (
        (instrument.symbol = '^GSPC' AND instrument.region_key = 'US')
        OR (instrument.symbol = '^IXIC' AND instrument.region_key = 'US')
        OR (instrument.symbol = 'EWY' AND instrument.region_key = 'KR')
        OR (instrument.symbol = 'EWJ' AND instrument.region_key = 'JP')
        OR (instrument.symbol = 'FXI' AND instrument.region_key = 'CN')
      )
  `).all(...symbols);

  return rows.map(({ symbol, region_key, close, return1d }) => {
    const missing = [close === null ? 'px_close' : null, return1d === null ? 'ret_1d' : null].filter((value): value is string => value !== null);
    return missing.length === 0 ? `${region_key}:${symbol}` : `${region_key}:${symbol} missing ${missing.join(' and ')}`;
  });
}

/** Reads each configured backbone's latest observed close and one-day return; missing rows stay absent. */
export function readMarketIndexMoves(db: Database): MarketIndexMove[] {
  const symbols = REQUIRED_INSTRUMENTS.map(({ symbol }) => symbol);
  const placeholders = symbols.map(() => '?').join(', ');
  const rows = db.query<MarketIndexMove, string[]>(`
    SELECT instrument.symbol, instrument.region_key AS region, daily.date,
      daily.px_close AS close, daily.ret_1d AS return1d
    FROM fact_market_daily AS daily
    JOIN dim_instrument AS instrument ON instrument.instrument_id = daily.instrument_id
    JOIN (
      SELECT instrument_id, MAX(date) AS date
      FROM fact_market_daily
      GROUP BY instrument_id
    ) AS latest ON latest.instrument_id = daily.instrument_id AND latest.date = daily.date
    WHERE instrument.symbol IN (${placeholders})
      AND daily.px_close IS NOT NULL
      AND daily.ret_1d IS NOT NULL
      AND (
        (instrument.symbol = '^GSPC' AND instrument.region_key = 'US')
        OR (instrument.symbol = '^IXIC' AND instrument.region_key = 'US')
        OR (instrument.symbol = 'EWY' AND instrument.region_key = 'KR')
        OR (instrument.symbol = 'EWJ' AND instrument.region_key = 'JP')
        OR (instrument.symbol = 'FXI' AND instrument.region_key = 'CN')
      )
    ORDER BY CASE instrument.region_key
      WHEN 'US' THEN 1 WHEN 'KR' THEN 2 WHEN 'JP' THEN 3 WHEN 'CN' THEN 4 ELSE 5 END,
      instrument.symbol
  `).all(...symbols);
  return rows;
}

export function readConfiguredMarketQuoteCoverage(): readonly string[] {
  const db = new Database(X_ASSET_DB, { readonly: true });
  try {
    return readMarketQuoteCoverage(db);
  } finally {
    db.close();
  }
}

export function readConfiguredMarketIndexMoves(): MarketIndexMove[] {
  const db = new Database(X_ASSET_DB, { readonly: true });
  try {
    return readMarketIndexMoves(db);
  } finally {
    db.close();
  }
}

export function probeMarketQuotesMulti(readCoverage: CoverageReader = readConfiguredMarketQuoteCoverage): ProbeResult {
  let covered: readonly string[];
  try {
    covered = readCoverage();
  } catch {
    covered = [];
  }

  const missing = REQUIRED_INSTRUMENTS.flatMap(({ symbol, region }) => {
    const key = `${region}:${symbol}`;
    const coverage = covered.find(value => value === key || value.startsWith(`${key} missing `));
    if (coverage === undefined) return [{ symbol, values: ['daily row'] }];
    if (coverage === key) return [];
    return [{ symbol, values: coverage.slice(`${key} missing `.length).split(' and ') }];
  });
  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    reason: `Daily market backbone data is missing ${missing.map(({ symbol, values }) => `${values.join(' and ')} for ${symbol}`).join(', ')}.`,
    repairHint: {
      paths: ['scripts/collect-market-daily.sh'],
      what: 'Run scripts/collect-market-daily.sh to populate fact_market_daily with px_close and ret_1d for the US, KR, JP, and CN backbone instruments.',
    },
  };
}

export function createMarketQuotesMultiProvider(readCoverage: CoverageReader = readConfiguredMarketQuoteCoverage): CapabilityProvider {
  return {
    id: 'market.quotes.multi',
    async probe(): Promise<ProbeResult> {
      return probeMarketQuotesMulti(readCoverage);
    },
  };
}

export default createMarketQuotesMultiProvider();
