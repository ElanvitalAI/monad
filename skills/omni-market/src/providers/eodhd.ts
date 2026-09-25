/**
 * EODHD Provider — Primary provider with global coverage.
 * 70+ exchanges, 150K+ tickers, forex, crypto, bonds, indices, macro.
 */

import { hasEnv, requireEnv } from '../env.js';
import type { Provider, Command, ApiOptions } from '../types.js';

const BASE = 'https://eodhd.com/api';

// ── Commands this provider handles ──
const SUPPORTED: Set<Command> = new Set([
  'eod', 'intraday', 'quote', 'fundamentals', 'technical',
  'news', 'sentiment', 'screener', 'search',
  'dividends', 'splits', 'insider',
  'macro', 'events', 'calendar',
  'bulk', 'exchanges', 'tickers',
  'market-cap', 'ust',
]);

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = requireEnv('EODHD_API_KEY');
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('api_token', apiKey);
  url.searchParams.set('fmt', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`EODHD ${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json() as Promise<T>;
}

function dateParams(opts: ApiOptions): Record<string, string> {
  const p: Record<string, string> = {};
  if (opts.from) p.from = opts.from;
  if (opts.to) p.to = opts.to;
  if (opts.order) p.order = opts.order;
  return p;
}

export const eodhd: Provider = {
  name: 'eodhd',

  available(): boolean {
    return hasEnv('EODHD_API_KEY');
  },

  supports(command: Command): boolean {
    return SUPPORTED.has(command);
  },

  async execute(command: Command, target: string, opts: ApiOptions) {
    switch (command) {
      case 'eod': {
        const params = dateParams(opts);
        if (opts.period) params.period = opts.period;
        return { data: await get(`/eod/${target}`, params), renderKey: 'eod' };
      }
      case 'intraday': {
        const params: Record<string, string> = {};
        if (opts.interval) params.interval = opts.interval;
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        return { data: await get(`/intraday/${target}`, params), renderKey: 'intraday' };
      }
      case 'quote':
        return { data: await get(`/real-time/${target}`), renderKey: 'quote' };
      case 'fundamentals':
        return { data: await get(`/fundamentals/${target}`), renderKey: 'fundamentals' };
      case 'technical': {
        const params = dateParams(opts);
        if (opts.func) params.function = opts.func;
        if (opts.funcPeriod) params.period = String(opts.funcPeriod);
        return { data: await get(`/technical/${target}`, params), renderKey: 'technical' };
      }
      case 'news': {
        const params: Record<string, string> = {};
        if (target) params.s = target;
        if (opts.topic) params.t = opts.topic;
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.offset) params.offset = String(opts.offset);
        return { data: await get('/news', params), renderKey: 'news' };
      }
      case 'sentiment': {
        const params: Record<string, string> = { s: target };
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        return { data: await get('/sentiments', params), renderKey: 'sentiment' };
      }
      case 'dividends':
        return { data: await get(`/div/${target}`, dateParams(opts)), renderKey: 'dividends' };
      case 'splits':
        return { data: await get(`/splits/${target}`, dateParams(opts)), renderKey: 'splits' };
      case 'insider': {
        const params: Record<string, string> = {};
        if (target) params.code = target;
        if (opts.code) params.code = opts.code;
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        if (opts.limit) params.limit = String(opts.limit);
        return { data: await get('/insider-transactions', params), renderKey: 'insider' };
      }
      case 'market-cap':
        return { data: await get(`/historical-market-cap/${target}`, dateParams(opts)), renderKey: 'market-cap' };
      case 'screener': {
        const params: Record<string, string> = {};
        if (opts.filters) params.filters = opts.filters;
        if (opts.signals) params.signals = opts.signals;
        if (opts.sort) params.sort = opts.sort;
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.offset) params.offset = String(opts.offset);
        const d = await get<any>('/screener', params);
        return { data: d.data || d, renderKey: 'screener' };
      }
      case 'search': {
        const params: Record<string, string> = {};
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.exchangeCode) params.exchange = opts.exchangeCode;
        if (opts.tickerType) params.type = opts.tickerType;
        return { data: await get(`/search/${encodeURIComponent(target)}`, params), renderKey: 'search' };
      }
      case 'macro': {
        const country = target || opts.country || 'USA';
        const params: Record<string, string> = {};
        if (opts.indicator) params.indicator = opts.indicator;
        return { data: await get(`/macro-indicator/${country}`, params), renderKey: 'macro' };
      }
      case 'events': {
        const params: Record<string, string> = {};
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        if (opts.country) params.country = opts.country;
        if (opts.limit) params.limit = String(opts.limit);
        if (opts.offset) params.offset = String(opts.offset);
        return { data: await get('/economic-events', params), renderKey: 'events' };
      }
      case 'calendar': {
        const calType = opts.calendarType || 'earnings';
        const params: Record<string, string> = {};
        if (opts.from) params.from = opts.from;
        if (opts.to) params.to = opts.to;
        if (opts.symbols) params.symbols = opts.symbols;
        return { data: await get(`/calendar/${calType}`, params), renderKey: 'calendar' };
      }
      case 'exchanges':
        return { data: await get('/exchanges-list/'), renderKey: 'exchanges' };
      case 'tickers': {
        const ex = target || opts.exchangeCode || 'US';
        const params: Record<string, string> = {};
        if (opts.delisted) params.delisted = '1';
        if (opts.tickerType) params.type = opts.tickerType;
        return { data: await get(`/exchange-symbol-list/${ex}`, params), renderKey: 'tickers' };
      }
      case 'bulk': {
        const ex = target || opts.exchangeCode || 'US';
        const params: Record<string, string> = {};
        if (opts.from) params.date = opts.from;
        if (opts.bulkType) params.type = opts.bulkType;
        if (opts.symbols) params.symbols = opts.symbols;
        if (opts.extended) params.filter = 'extended';
        return { data: await get(`/eod-bulk-last-day/${ex}`, params), renderKey: 'bulk' };
      }
      case 'ust': {
        const rateType = target || 'yield-rates';
        const params: Record<string, string> = {};
        if (opts.from) params['filter[year]'] = opts.from.slice(0, 4);
        if (opts.limit) params['page[limit]'] = String(opts.limit);
        if (opts.offset) params['page[offset]'] = String(opts.offset);
        return { data: await get(`/ust/${rateType}`, params), renderKey: 'ust' };
      }
      default:
        throw new Error(`eodhd: unsupported command: ${command}`);
    }
  },
};
