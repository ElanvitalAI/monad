import { test, expect, describe } from 'bun:test';
import { classify, formatMarketQuote, type MarketQuote } from './market-quote.js';

describe('classify — 심볼 → 시장 분류', () => {
  test('KR 주식', () => {
    expect(classify('005930.KO')).toBe('kr-equity');
    expect(classify('005930.KS')).toBe('kr-equity');
    expect(classify('005930')).toBe('kr-equity');       // 6자리
  });
  test('US 주식', () => {
    expect(classify('KORU.US')).toBe('us-equity');
    expect(classify('AAPL')).toBe('us-equity');          // 순수 티커
  });
  test('지수/FX', () => {
    expect(classify('KS11.INDX')).toBe('index');
    expect(classify('^J203.JO')).toBe('index');
    expect(classify('USDKRW.FOREX')).toBe('fx');
  });
});

describe('formatMarketQuote', () => {
  const q = (o: Partial<MarketQuote>): MarketQuote => ({
    symbol: 'X', market: 'kr-equity', price: null, prevClose: null, changePct: null, high: null,
    source: 'none', session: '', freshness: 'eod', ...o,
  });
  test('실시간 토스', () => {
    const s = formatMarketQuote(q({ symbol: '005930', price: 318000, changePct: 1.11, source: 'toss', session: 'KR NXT', freshness: 'live' }));
    expect(s).toContain('318,000');
    expect(s).toContain('🟢실시간[toss]');
  });
  test('종가/조회실패', () => {
    expect(formatMarketQuote(q({ price: null, note: '조회 실패' }))).toContain('조회 실패');
    expect(formatMarketQuote(q({ symbol: 'USDKRW.FOREX', price: 1532, source: 'eodhd', freshness: 'eod' }))).toContain('⚪종가[eodhd]');
  });
});
