/**
 * Yahoo Finance Provider — free (no API key) authority for global INDICES
 * and FUTURES.
 *
 * EODHD's `.INDX` coverage is effectively US/KR only — N225/GDAXI/BSESN/BVSP
 * and most non-US indices come back as an empty 200 (no error, so the router's
 * throw-based fallback never fires). Yahoo's public chart endpoint covers all
 * of them for free. Scoped to eod/quote on INDEX/FUTURES targets so US
 * equities, fundamentals, etc. keep routing to EODHD/FDS unchanged; Yahoo is
 * ordered FIRST in the router so these resolve here before EODHD returns empty.
 *
 * Futures (2026-07-15): EODHD has no working futures quotes (CL.COMM/BZ.COMM
 * return empty), so `XXX.FUT` → Yahoo `XXX=F` lives here — oil (CL/BZ), index
 * futures (ES/NQ/YM/RTY), metals (GC/SI/HG), nat-gas (NG). Raw `XXX=F` symbols
 * pass through unchanged. toss.supports() only claims US/KR suffixes and
 * bare-alnum symbols, so neither `.FUT` nor `=F` gets shadowed by toss.
 */

import type { Provider, Command, ApiOptions, PriceBar, Quote } from '../types.js';

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

// EODHD-style index code → Yahoo symbol. General rule: `XXX.INDX` → `^XXX`.
// Aliases cover the cases where Yahoo's symbol differs from `^`+code.
const INDEX_ALIASES: Record<string, string> = {
  'SSEC.INDX': '000001.SS',   // Shanghai Composite
  'SZSC.INDX': '399001.SZ',   // Shenzhen Component
  'HSI.INDX': '^HSI',         // Hang Seng
  'STOXX50E.INDX': '^STOXX50E',
};

// Friendly futures aliases → Yahoo continuous-contract symbol. General rule:
// `XXX.FUT` → `XXX=F`; aliases cover human names (WTI/BRENT) that differ from
// the exchange root.
const FUTURES_ALIASES: Record<string, string> = {
  'WTI.FUT': 'CL=F',      // WTI crude
  'BRENT.FUT': 'BZ=F',    // Brent crude
  'SP500.FUT': 'ES=F',    // S&P 500 e-mini
  'NASDAQ.FUT': 'NQ=F',   // Nasdaq 100 e-mini
  'GOLD.FUT': 'GC=F',
  'SILVER.FUT': 'SI=F',
  'NATGAS.FUT': 'NG=F',
};

/** Translate an EODHD index code / futures code (or a raw Yahoo symbol) →
 *  Yahoo symbol. Returns null when the target is not one Yahoo should own. */
function toYahoo(target: string): string | null {
  if (!target) return null;
  if (target.startsWith('^')) return target;                       // already Yahoo (^GSPC)
  if (/^[A-Za-z0-9]+=F$/i.test(target)) return target.toUpperCase(); // raw futures (CL=F)
  if (/\.(SS|SZ|HK|T|KS|L|DE|PA)$/i.test(target)) return target;   // Yahoo-suffixed exchange symbol
  if (INDEX_ALIASES[target]) return INDEX_ALIASES[target];
  if (FUTURES_ALIASES[target.toUpperCase()]) return FUTURES_ALIASES[target.toUpperCase()];
  const f = /^([A-Za-z0-9]+)\.FUT$/i.exec(target);                 // CL.FUT → CL=F
  if (f) return `${f[1].toUpperCase()}=F`;
  const m = /^([A-Za-z0-9]+)\.INDX$/.exec(target);                 // GSPC.INDX → ^GSPC
  if (m) return `^${m[1]}`;
  return null;
}

const isIndexTarget = (target?: string): boolean => !!target && toYahoo(target) !== null;

const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const unix = (d: string): number => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000);

async function chart(symbol: string, opts: { range?: string; from?: string; to?: string }): Promise<any> {
  const url = new URL(`${CHART}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1d');
  if (opts.from || opts.to) {
    url.searchParams.set('period1', String(opts.from ? unix(opts.from) : unix('2000-01-01')));
    url.searchParams.set('period2', String(opts.to ? unix(opts.to) + 86_400 : Math.floor(Date.now() / 1000)));
  } else {
    url.searchParams.set('range', opts.range && RANGES.has(opts.range) ? opts.range : '1mo');
  }
  const res = await fetch(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${res.statusText}`);
  const j: any = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) {
    const desc = j?.chart?.error?.description ?? 'no result';
    throw new Error(`Yahoo: ${desc} for ${symbol}`);
  }
  return r;
}

function toBars(r: any): PriceBar[] {
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: PriceBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close?.[i] == null) continue;   // Yahoo emits null bars for holidays
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? 0, high: q.high?.[i] ?? 0, low: q.low?.[i] ?? 0,
      close: q.close[i], volume: q.volume?.[i] ?? 0,
      adjusted_close: adj[i] ?? q.close[i],
    });
  }
  return bars;
}

export const yahoo: Provider = {
  name: 'yahoo',

  // No API key required — always usable as the index authority / free fallback.
  available: () => true,

  supports(command: Command, symbol?: string): boolean {
    return (command === 'eod' || command === 'quote') && isIndexTarget(symbol);
  },

  async execute(command: Command, target: string, opts: ApiOptions) {
    const sym = toYahoo(target);
    if (!sym) throw new Error(`yahoo: not an index target: ${target}`);

    if (command === 'quote') {
      const r = await chart(sym, { range: '5d' });
      const meta = r.meta ?? {};
      const bars = toBars(r);
      const last = bars[bars.length - 1];
      const close = meta.regularMarketPrice ?? last?.close ?? 0;
      // Prefer the actual prior bar over meta.chartPreviousClose: for some
      // indices (observed on KS11 2026-07-14) chartPreviousClose lags several
      // sessions, producing wildly wrong change% (-13.7% on a -3% day).
      const previousClose = bars[bars.length - 2]?.close ?? meta.chartPreviousClose ?? close;
      const quote: Quote = {
        code: target,
        timestamp: Number(meta.regularMarketTime ?? 0),
        open: last?.open ?? 0, high: last?.high ?? 0, low: last?.low ?? 0,
        close, volume: last?.volume ?? 0, previousClose,
        change: close - previousClose,
        change_p: previousClose ? ((close - previousClose) / previousClose) * 100 : 0,
      };
      return { data: quote, renderKey: 'quote' };
    }

    // eod — honour from/to (period1/period2) or default to a 1-month range.
    let bars = toBars(await chart(sym, { from: opts.from, to: opts.to }));
    if (opts.order === 'd') bars = bars.reverse();
    return { data: bars, renderKey: 'eod' };
  },
};
