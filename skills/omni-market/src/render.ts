/**
 * Unified Markdown Renderer — renders data from any provider.
 */

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function num(v: number | undefined | null, digits = 2): string {
  if (v === null || v === undefined) return '-';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function pct(v: number | undefined | null): string {
  if (v === null || v === undefined) return '-';
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
}

// ── Render by key ──

export function render(key: string, data: any, meta: { target?: string; func?: string; calendarType?: string; country?: string; indicator?: string; exchange?: string; provider?: string } = {}): string {
  const providerTag = meta.provider ? ` [${meta.provider}]` : '';

  switch (key) {
    case 'eod': return renderEod(data, meta.target || '?') + providerTag;
    case 'intraday': return renderIntraday(data, meta.target || '?') + providerTag;
    case 'quote': return renderQuote(data) + providerTag;
    case 'fundamentals': return renderFundamentals(data, meta.target || '?') + providerTag;
    case 'technical': return renderTechnical(data, meta.target || '?', meta.func || '?') + providerTag;
    case 'news': return renderNews(data) + providerTag;
    case 'sentiment': return renderSentiment(data) + providerTag;
    case 'dividends': return renderDividends(data, meta.target || '?') + providerTag;
    case 'splits': return renderSplits(data, meta.target || '?') + providerTag;
    case 'insider': return renderInsider(data) + providerTag;
    case 'screener': return renderScreener(data) + providerTag;
    case 'search': return renderSearch(data) + providerTag;
    case 'macro': return renderMacro(data, meta.country || '?', meta.indicator || '?') + providerTag;
    case 'events': return renderEvents(data) + providerTag;
    case 'calendar': return renderCalendar(data, meta.calendarType || 'earnings') + providerTag;
    case 'exchanges': return renderExchanges(data) + providerTag;
    case 'tickers': return renderTickers(data, meta.exchange || '?') + providerTag;
    case 'bulk': return renderBulk(data, meta.exchange || '?') + providerTag;
    case 'ust': return renderUST(data, meta.target || 'yield-rates') + providerTag;
    case 'market-cap': return renderMarketCap(data, meta.target || '?') + providerTag;
    case 'earnings': return renderEarnings(data, meta.target || '?') + providerTag;
    case 'filings': return renderFilings(data, meta.target || '?') + providerTag;
    case 'institutional': return renderInstitutional(data, meta.target || '?') + providerTag;
    case 'company': return renderCompany(data) + providerTag;
    default: return `## ${key}\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 2000)}\n\`\`\``;
  }
}

// ── Individual renderers ──

function renderEod(data: any[], symbol: string): string {
  const rows = data.slice(-30).map((b: any) => [
    b.date, num(b.open), num(b.high), num(b.low), num(b.close), num(b.adjusted_close), num(b.volume, 0),
  ]);
  return `## ${symbol} EOD (${data.length}건, 최근 30건)\n\n` +
    table(['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'], rows);
}

function renderIntraday(data: any[], symbol: string): string {
  const rows = data.slice(-30).map((b: any) => [
    b.datetime, num(b.open), num(b.high), num(b.low), num(b.close), num(b.volume, 0),
  ]);
  return `## ${symbol} Intraday (${data.length}건, 최근 30건)\n\n` +
    table(['Datetime', 'Open', 'High', 'Low', 'Close', 'Volume'], rows);
}

function renderQuote(q: any): string {
  return `## ${q.code} Real-Time Quote\n\n` +
    `- **Close:** ${num(q.close)}  |  **Change:** ${num(q.change)} (${pct(q.change_p)})\n` +
    `- **Open:** ${num(q.open)}  |  **High:** ${num(q.high)}  |  **Low:** ${num(q.low)}\n` +
    `- **Volume:** ${num(q.volume, 0)}  |  **Prev Close:** ${num(q.previousClose)}\n` +
    `- **Timestamp:** ${new Date((q.timestamp || 0) * 1000).toISOString()}`;
}

function renderFundamentals(data: any, symbol: string): string {
  const g = data.General || {};
  const h = data.Highlights || {};
  const v = data.Valuation || {};
  const t = data.Technicals || {};

  let md = `## ${symbol} Fundamentals\n\n`;
  md += `### General\n`;
  md += `- **Name:** ${g.Name || '-'}  |  **Exchange:** ${g.Exchange || '-'}\n`;
  md += `- **Sector:** ${g.Sector || '-'}  |  **Industry:** ${g.Industry || '-'}\n`;
  md += `- **Country:** ${g.CountryName || '-'}  |  **Currency:** ${g.CurrencyCode || '-'}\n`;
  if (g.Description) md += `\n> ${g.Description.slice(0, 300)}...\n`;

  md += `\n### Highlights\n`;
  md += `- **Market Cap:** ${num(h.MarketCapitalization, 0)}\n`;
  md += `- **EPS:** ${num(h.EarningsShare)}  |  **P/E:** ${num(h.PERatio)}\n`;
  md += `- **Dividend Yield:** ${pct(h.DividendYield ? h.DividendYield * 100 : null)}\n`;
  md += `- **Revenue:** ${num(h.Revenue, 0)}  |  **Profit Margin:** ${pct(h.ProfitMargin ? h.ProfitMargin * 100 : null)}\n`;
  md += `- **Beta:** ${num(t.Beta)}\n`;

  md += `\n### Valuation\n`;
  md += `- **Forward P/E:** ${num(v.ForwardPE)}  |  **PEG:** ${num(v.PEGRatio)}\n`;
  md += `- **P/B:** ${num(v.PriceBookMRQ)}  |  **P/S:** ${num(v.PriceSalesTTM)}\n`;
  md += `- **EV/Revenue:** ${num(v.EnterpriseValueRevenue)}  |  **EV/EBITDA:** ${num(v.EnterpriseValueEbitda)}\n`;

  return md;
}

function renderTechnical(data: any[], symbol: string, func: string): string {
  const rows = data.slice(-30).map((d: any) => {
    const keys = Object.keys(d).filter(k => k !== 'date');
    return [d.date, ...keys.map(k => num(d[k]))];
  });
  const sampleKeys = data.length > 0 ? Object.keys(data[0]).filter(k => k !== 'date') : ['value'];
  return `## ${symbol} ${func.toUpperCase()} (${data.length}건, 최근 30건)\n\n` +
    table(['Date', ...sampleKeys], rows);
}

function renderNews(articles: any[]): string {
  const items = articles.slice(0, 20).map((a: any) => {
    const sent = a.sentiment ? ` | Sentiment: ${a.sentiment.polarity}` : '';
    return `### ${a.title}\n- **Date:** ${a.date}${sent}\n- **Source:** ${a.link}\n- ${a.content?.slice(0, 200) || ''}...\n`;
  });
  return `## Financial News (${articles.length}건, 최대 20건)\n\n${items.join('\n')}`;
}

function renderSentiment(data: any): string {
  let md = `## Sentiment Data\n\n`;
  for (const [symbol, days] of Object.entries(data)) {
    md += `### ${symbol}\n\n`;
    const rows = (days as any[]).slice(-20).map((d: any) => [d.date, String(d.count), num(d.normalized, 4)]);
    md += table(['Date', 'Count', 'Normalized'], rows) + '\n\n';
  }
  return md;
}

function renderDividends(data: any[], symbol: string): string {
  const rows = data.slice(-20).map((d: any) => [d.date, num(d.value, 4), d.currency || '-', d.payment_date || '-']);
  return `## ${symbol} Dividends (${data.length}건, 최근 20건)\n\n` +
    table(['Ex-Date', 'Amount', 'Currency', 'Payment Date'], rows);
}

function renderSplits(data: any[], symbol: string): string {
  const rows = data.map((s: any) => [s.date, s.split]);
  return `## ${symbol} Splits (${data.length}건)\n\n` + table(['Date', 'Ratio'], rows);
}

function renderInsider(data: any[]): string {
  const rows = data.slice(0, 30).map((t: any) => [
    t.date || t.ownerName ? t.date : '-', t.ownerName || '-', t.transactionType || '-',
    num(t.transactionShares, 0), num(t.transactionPrice), t.ownerTitle || '-',
  ]);
  return `## Insider Transactions (${data.length}건, 최대 30건)\n\n` +
    table(['Date', 'Owner', 'Type', 'Shares', 'Price', 'Title'], rows);
}

function renderScreener(data: any[]): string {
  const rows = data.map((s: any) => [
    s.code || s.ticker || '-', (s.name || '-').slice(0, 25), s.exchange || '-', (s.sector || '-').slice(0, 15),
    num(s.market_capitalization || s.market_cap, 0), num(s.earnings_share || s.eps), pct(s.refund_1d_p),
  ]);
  return `## Screener Results (${data.length}건)\n\n` +
    table(['Code', 'Name', 'Exchange', 'Sector', 'Market Cap', 'EPS', '1D Return'], rows);
}

function renderSearch(data: any[]): string {
  const rows = data.map((s: any) => [s.Code, s.Exchange, (s.Name || '-').slice(0, 30), s.Type || '-', s.Country || '-']);
  return `## Search Results (${data.length}건)\n\n` +
    table(['Code', 'Exchange', 'Name', 'Type', 'Country'], rows);
}

function renderMacro(data: any[], country: string, indicator: string): string {
  const rows = data.slice(-20).map((d: any) => [d.Date || d.date, d.Period || d.period || '-', num(d.Value || d.value, 4)]);
  return `## ${country} — ${indicator} (${data.length}건, 최근 20건)\n\n` +
    table(['Date', 'Period', 'Value'], rows);
}

function renderEvents(data: any[]): string {
  const rows = data.slice(0, 30).map((e: any) => [
    e.date, e.country, (e.type || '-').slice(0, 30), num(e.actual), num(e.estimate), num(e.previous),
  ]);
  return `## Economic Events (${data.length}건, 최대 30건)\n\n` +
    table(['Date', 'Country', 'Event', 'Actual', 'Estimate', 'Previous'], rows);
}

function renderCalendar(data: any, type: string): string {
  const items = data?.earnings || data?.ipos || data?.splits || data?.trends || data || [];
  if (!Array.isArray(items) || items.length === 0) return `## Calendar: ${type}\n\nNo data.`;
  if (type === 'earnings') {
    const rows = items.slice(0, 30).map((e: any) => [e.code || '-', e.report_date || e.date || '-', num(e.actual), num(e.estimate), pct(e.percent)]);
    return `## Earnings Calendar (${items.length}건, 최대 30건)\n\n` +
      table(['Code', 'Date', 'Actual', 'Estimate', 'Surprise%'], rows);
  }
  return `## Calendar: ${type} (${items.length}건)\n\n\`\`\`json\n${JSON.stringify(items.slice(0, 10), null, 2)}\n\`\`\``;
}

function renderExchanges(data: any[]): string {
  const rows = data.map((e: any) => [e.Code, e.Name, e.Country, e.Currency, e.OperatingMIC || '-']);
  return `## Exchanges (${data.length}건)\n\n` + table(['Code', 'Name', 'Country', 'Currency', 'MIC'], rows);
}

function renderTickers(data: any[], exchange: string): string {
  const rows = data.slice(0, 50).map((t: any) => [t.Code, (t.Name || '-').slice(0, 30), t.Type || '-', t.Currency || '-']);
  return `## ${exchange} Tickers (${data.length}건, 최대 50건)\n\n` +
    table(['Code', 'Name', 'Type', 'Currency'], rows);
}

function renderBulk(data: any[], exchange: string): string {
  const rows = data.slice(0, 30).map((b: any) => [b.code || '-', num(b.close), num(b.adjusted_close), num(b.volume, 0), pct(b.p_change)]);
  return `## ${exchange} Bulk EOD (${data.length}건, 최대 30건)\n\n` +
    table(['Code', 'Close', 'Adj Close', 'Volume', 'Change%'], rows);
}

function renderUST(data: any, rateType: string): string {
  const items = Array.isArray(data) ? data : (data?.data || []);
  if (!items.length) return `## US Treasury: ${rateType}\n\nNo data.`;
  const sample = items[0];
  const keys = Object.keys(sample).filter(k => k !== 'date' && k !== 'id');
  const rows = items.slice(-20).map((d: any) => [d.date || '-', ...keys.map((k: string) => num(d[k], 3))]);
  return `## US Treasury — ${rateType} (${items.length}건, 최근 20건)\n\n` +
    table(['Date', ...keys], rows);
}

function renderMarketCap(data: any[], symbol: string): string {
  const rows = data.slice(-20).map((d: any) => [d.date || '-', num(d.value || d.marketCapitalization, 0)]);
  return `## ${symbol} Historical Market Cap (${data.length}건, 최근 20건)\n\n` +
    table(['Date', 'Market Cap'], rows);
}

// ── FDS-specific renderers ──

function renderEarnings(data: any, ticker: string): string {
  if (!data || typeof data !== 'object') return `## ${ticker} Earnings\n\nNo data.`;

  // Handle both single object and array
  const q = data.quarterly || data;
  if (q && !Array.isArray(q)) {
    let md = `## ${ticker} Earnings\n\n`;
    md += `- **Revenue:** ${num(q.revenue, 0)} (Est: ${num(q.estimated_revenue, 0)}) ${q.revenue_surprise || ''}\n`;
    md += `- **EPS:** ${num(q.earnings_per_share)} (Est: ${num(q.estimated_earnings_per_share)}) ${q.eps_surprise || ''}\n`;
    md += `- **Net Income:** ${num(q.net_income, 0)}\n`;
    md += `- **Operating Income:** ${num(q.operating_income, 0)}\n`;
    md += `- **Cash:** ${num(q.cash_and_equivalents, 0)}  |  **Debt:** ${num(q.total_debt, 0)}\n`;
    return md;
  }

  return `## ${ticker} Earnings\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 2000)}\n\`\`\``;
}

function renderFilings(data: any[], ticker: string): string {
  const rows = data.slice(0, 20).map((f: any) => [
    f.filing_type || '-', f.filed_date || f.date || '-', (f.description || '-').slice(0, 40), f.url ? '[link]' : '-',
  ]);
  return `## ${ticker} SEC Filings (${data.length}건, 최대 20건)\n\n` +
    table(['Type', 'Filed Date', 'Description', 'URL'], rows);
}

function renderInstitutional(data: any[], ticker: string): string {
  const rows = data.slice(0, 20).map((h: any) => [
    (h.investor_name || h.investor || '-').slice(0, 30),
    num(h.shares, 0), num(h.value, 0),
    h.report_period || '-',
  ]);
  return `## ${ticker} Institutional Ownership (${data.length}건, 최대 20건)\n\n` +
    table(['Investor', 'Shares', 'Value', 'Period'], rows);
}

function renderCompany(data: any): string {
  let md = `## Company Facts\n\n`;
  md += `- **Name:** ${data.name || '-'}\n`;
  md += `- **Ticker:** ${data.ticker || '-'}  |  **CIK:** ${data.cik || '-'}\n`;
  md += `- **Exchange:** ${data.exchange || '-'}\n`;
  md += `- **Sector:** ${data.sector || '-'}  |  **Industry:** ${data.industry || '-'}\n`;
  md += `- **Market Cap:** ${num(data.market_cap, 0)}\n`;
  md += `- **Employees:** ${num(data.employees, 0)}\n`;
  if (data.description) md += `\n> ${data.description.slice(0, 400)}...\n`;
  return md;
}
