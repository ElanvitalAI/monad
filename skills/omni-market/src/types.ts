/* ── Unified types across all providers ── */

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjusted_close?: number;
}

export interface Quote {
  code: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number;
  change: number;
  change_p: number;
}

export interface Fundamentals {
  general: { name: string; exchange: string; sector: string; industry: string; country: string; currency: string; description?: string; ipoDate?: string; employees?: number };
  highlights: { marketCap: number; eps: number; pe: number; dividendYield: number | null; revenue: number; profitMargin: number | null; beta?: number; targetPrice?: number };
  valuation: { forwardPE: number | null; peg: number | null; pb: number | null; ps: number | null; evRevenue: number | null; evEbitda: number | null };
}

export interface EarningsData {
  ticker: string;
  report_period: string;
  revenue: number;
  estimated_revenue?: number;
  revenue_surprise?: string;
  eps: number;
  estimated_eps?: number;
  eps_surprise?: string;
}

export interface InsiderTrade {
  date: string;
  name: string;
  type: string;
  shares: number;
  price: number;
  title: string;
}

export interface NewsArticle {
  date: string;
  title: string;
  content: string;
  link: string;
  symbols: string[];
  sentiment?: { polarity: string };
}

export interface FilingEntry {
  date: string;
  type: string;
  url: string;
  description?: string;
}

export interface InstitutionalHolder {
  investor: string;
  shares: number;
  value: number;
  report_period: string;
  change?: number;
}

export interface ScreenerResult {
  code: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  market_capitalization: number;
  [key: string]: any;
}

export interface SearchResult {
  code: string;
  exchange: string;
  name: string;
  type: string;
  country: string;
}

export interface MacroDataPoint {
  date: string;
  period: string;
  value: number;
  country?: string;
}

/* ── Provider interface ── */

export interface ProviderResult<T = any> {
  provider: string;
  data: T;
}

export interface ApiOptions {
  from?: string;
  to?: string;
  period?: 'd' | 'w' | 'm';
  order?: 'a' | 'd';
  limit?: number;
  offset?: number;
  interval?: '1m' | '5m' | '1h';
  func?: string;
  funcPeriod?: number;
  filters?: string;
  signals?: string;
  sort?: string;
  country?: string;
  indicator?: string;
  calendarType?: 'earnings' | 'trends' | 'ipos' | 'splits';
  topic?: string;
  code?: string;
  comparison?: string;
  eventType?: string;
  exchangeCode?: string;
  delisted?: boolean;
  tickerType?: string;
  bulkType?: 'eod' | 'splits' | 'dividends';
  symbols?: string;
  extended?: boolean;
  // financialdatasets.ai specific
  filing_type?: string;
  period_type?: 'quarterly' | 'annual';
}

/* ── Provider capability ── */

export type Command =
  | 'eod' | 'intraday' | 'quote' | 'fundamentals' | 'technical'
  | 'news' | 'sentiment' | 'screener' | 'search'
  | 'dividends' | 'splits' | 'insider'
  | 'macro' | 'events' | 'calendar'
  | 'bulk' | 'exchanges' | 'tickers'
  | 'market-cap' | 'ust'
  // financialdatasets.ai commands
  | 'earnings' | 'filings' | 'institutional' | 'company';

export interface Provider {
  name: string;
  available(): boolean;
  supports(command: Command, symbol?: string): boolean;
  execute(command: Command, target: string, opts: ApiOptions): Promise<{ data: any; renderKey: string }>;
}
