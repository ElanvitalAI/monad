/**
 * Financial Datasets (financialdatasets.ai) Provider
 * US stocks only — 17,000+ tickers, 30+ years history.
 * Strong on fundamentals, SEC filings, earnings, insider trades, institutional ownership.
 *
 * API docs: https://docs.financialdatasets.ai
 * Auth: X-API-KEY header
 * Base: https://api.financialdatasets.ai
 */

import { hasEnv, requireEnv } from '../env.js';
import type { Provider, Command, ApiOptions } from '../types.js';

const BASE = 'https://api.financialdatasets.ai';

// Commands this provider handles
const SUPPORTED: Set<Command> = new Set([
  'eod', 'quote', 'fundamentals', 'earnings', 'insider',
  'filings', 'institutional', 'company', 'screener', 'search',
]);

// Only US tickers — detect by symbol format
function isUSTicker(symbol: string): boolean {
  if (!symbol) return false;
  // EODHD format: AAPL.US → US ticker
  if (symbol.endsWith('.US')) return true;
  // Plain ticker without exchange suffix → assume US
  if (!symbol.includes('.')) return true;
  return false;
}

// Convert EODHD symbol format to plain ticker
function toPlainTicker(symbol: string): string {
  return symbol.replace(/\.(US|NYSE|NASDAQ)$/i, '');
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = requireEnv('FDS_API_KEY');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FDS ${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: any): Promise<T> {
  const apiKey = requireEnv('FDS_API_KEY');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FDS ${res.status}: ${res.statusText} — ${text}`);
  }
  return res.json() as Promise<T>;
}

export const fds: Provider = {
  name: 'fds',

  available(): boolean {
    return hasEnv('FDS_API_KEY');
  },

  supports(command: Command, symbol?: string): boolean {
    if (!SUPPORTED.has(command)) return false;
    // US-only provider — reject non-US symbols
    if (symbol && !isUSTicker(symbol)) return false;
    return true;
  },

  async execute(command: Command, target: string, opts: ApiOptions) {
    const ticker = toPlainTicker(target);

    switch (command) {
      case 'eod': {
        // GET /prices?ticker=X&start_date=&end_date=&interval=day
        const params: Record<string, string> = { ticker };
        if (opts.from) params.start_date = opts.from;
        if (opts.to) params.end_date = opts.to;
        if (opts.period === 'w') params.interval = 'week';
        else if (opts.period === 'm') params.interval = 'month';
        else params.interval = 'day';
        if (opts.limit) params.limit = String(opts.limit);
        const res = await get<any>('/prices', params);
        // Normalize to eodhd-compatible format
        const prices = (res.prices || []).map((p: any) => ({
          date: p.time?.slice(0, 10) || p.date,
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
          adjusted_close: p.close,
          volume: p.volume,
        }));
        return { data: prices, renderKey: 'eod' };
      }

      case 'quote': {
        // GET /prices/snapshot?ticker=X
        const res = await get<any>('/prices/snapshot', { ticker });
        const s = res.snapshot || {};
        return {
          data: {
            code: ticker,
            timestamp: Date.now() / 1000,
            open: s.open ?? 0,
            high: s.high ?? 0,
            low: s.low ?? 0,
            close: s.close ?? s.price ?? 0,
            volume: s.volume ?? 0,
            previousClose: s.previous_close ?? 0,
            change: s.change ?? 0,
            change_p: s.change_percent ?? 0,
          },
          renderKey: 'quote',
        };
      }

      case 'fundamentals': {
        // Combine income statement + company facts for eodhd-compatible output
        const [incRes, compRes] = await Promise.all([
          get<any>('/financials/income-statements', { ticker, period: 'annual', limit: '1' }).catch(() => ({ income_statements: [] })),
          get<any>('/company/facts', { ticker }).catch(() => ({ company_facts: {} })),
        ]);
        const stmt = incRes.income_statements?.[0] || {};
        const facts = compRes.company_facts || {};
        return {
          data: {
            _provider: 'fds',
            General: {
              Name: facts.name || ticker,
              Exchange: facts.exchange || '-',
              Sector: facts.sector || '-',
              Industry: facts.industry || '-',
              CountryName: 'United States',
              CurrencyCode: 'USD',
              Description: facts.description || '',
            },
            Highlights: {
              MarketCapitalization: facts.market_cap || 0,
              EarningsShare: stmt.basic_earnings_per_share || 0,
              PERatio: null,
              DividendYield: null,
              Revenue: stmt.revenue || 0,
              ProfitMargin: stmt.revenue ? (stmt.net_income || 0) / stmt.revenue : null,
            },
            Valuation: {
              ForwardPE: null,
              PEGRatio: null,
              PriceBookMRQ: null,
              PriceSalesTTM: null,
              EnterpriseValueRevenue: null,
              EnterpriseValueEbitda: null,
            },
            Technicals: {},
          },
          renderKey: 'fundamentals',
        };
      }

      case 'earnings': {
        const params: Record<string, string> = { ticker };
        if (opts.limit) params.limit = String(opts.limit);
        const res = await get<any>('/earnings', params);
        return { data: res.earnings || res, renderKey: 'earnings' };
      }

      case 'insider': {
        const params: Record<string, string> = { ticker };
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.from) params.filing_date_gte = opts.from;
        if (opts.to) params.filing_date_lte = opts.to;
        const res = await get<any>('/insider-trades', params);
        // Normalize to eodhd-compatible format
        const trades = (res.insider_trades || []).map((t: any) => ({
          date: t.transaction_date || t.filing_date,
          ownerName: t.name || t.owner || '-',
          transactionType: t.transaction_type || '-',
          transactionShares: t.transaction_shares || 0,
          transactionPrice: t.price_per_share || 0,
          ownerTitle: t.owner_title || t.relationship || '-',
        }));
        return { data: trades, renderKey: 'insider' };
      }

      case 'filings': {
        const params: Record<string, string> = { ticker };
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.filing_type) params.filing_type = opts.filing_type;
        const res = await get<any>('/filings', params);
        return { data: res.filings || [], renderKey: 'filings' };
      }

      case 'institutional': {
        const params: Record<string, string> = { ticker };
        if (opts.limit) params.limit = String(opts.limit);
        const res = await get<any>(`/institutional-ownership/ticker`, params);
        return { data: res['institutional-ownership'] || res.institutional_ownership || [], renderKey: 'institutional' };
      }

      case 'company': {
        const res = await get<any>('/company/facts', { ticker });
        return { data: res.company_facts || res, renderKey: 'company' };
      }

      case 'screener': {
        const filters = opts.filters ? JSON.parse(opts.filters) : [];
        const body: any = { limit: opts.limit || 10 };
        if (filters.length) {
          body.filters = filters.map((f: any[]) => ({
            field: f[0],
            operator: f[1] === '>' ? 'gt' : f[1] === '<' ? 'lt' : f[1] === '>=' ? 'gte' : f[1] === '<=' ? 'lte' : 'eq',
            value: f[2],
          }));
        }
        const res = await post<any>('/financials/search-screener', body);
        return { data: res.results || [], renderKey: 'screener' };
      }

      case 'search': {
        // FDS doesn't have a direct search endpoint, use company facts
        const res = await get<any>('/company/facts', { ticker: target.toUpperCase() });
        const facts = res.company_facts;
        if (facts) {
          return {
            data: [{ Code: facts.ticker || target, Exchange: facts.exchange || 'US', Name: facts.name || target, Type: 'Common Stock', Country: 'USA', ISIN: '' }],
            renderKey: 'search',
          };
        }
        return { data: [], renderKey: 'search' };
      }

      default:
        throw new Error(`fds: unsupported command: ${command}`);
    }
  },
};
