import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as childProcess from 'node:child_process';

// ⛔ R-TST23 — mock.module 은 «프로세스 전역»이고 mock.restore() 로 안 돌아온다.
//   되돌리려면 «펼친 스냅샷»이어야 한다(네임스페이스 참조는 mock 이 제자리에서 바꾼다).
const realChildProcess = { ...childProcess };
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildMarketQuoteTool,
  dispatchMarketQuote,
  marketQuoteAvailable,
} from '../src/skills/tools/market-quote.js';

const ORIG = {
  EODHD: process.env.EODHD_API_KEY,
  FDS: process.env.FDS_API_KEY,
};
const OMNI = join(homedir(), '.claude/skills/omni-market/scripts/main.ts');

let session = { krLive: false, kr: 'CLOSED', krHoliday: false, usLive: false, usOvernight: false, us: 'CLOSED', usHoliday: false };
let tossResult: { last: number; prevClose?: number; high?: number } | null = null;
let subprocessOutput: string | Error = new Error('subprocess unavailable');
const tossCalls: string[] = [];
const subprocessCalls: Array<[string, string[]]> = [];

mock.module('../src/domains/finance.js', () => ({
  marketSessions: () => session,
}));
mock.module('../src/domains/toss-quote.js', () => ({
  fetchTossQuote: (symbol: string) => {
    tossCalls.push(symbol);
    return tossResult;
  },
}));
mock.module('node:child_process', () => ({
  ...childProcess,
  execFileSync: (command: string, args: string[]) => {
    subprocessCalls.push([command, args]);
    expect(command).toBe('bun');
    expect(args).toEqual([OMNI, 'quote', expect.any(String), '--json']);
    if (subprocessOutput instanceof Error) throw subprocessOutput;
    return subprocessOutput;
  },
}));

beforeEach(() => {
  delete process.env.EODHD_API_KEY;
  delete process.env.FDS_API_KEY;
  session = { krLive: false, kr: 'CLOSED', krHoliday: false, usLive: false, usOvernight: false, us: 'CLOSED', usHoliday: false };
  tossResult = null;
  subprocessOutput = new Error('subprocess unavailable');
  tossCalls.length = 0;
  subprocessCalls.length = 0;
});

afterEach(() => {
  if (ORIG.EODHD !== undefined) process.env.EODHD_API_KEY = ORIG.EODHD; else delete process.env.EODHD_API_KEY;
  if (ORIG.FDS !== undefined) process.env.FDS_API_KEY = ORIG.FDS; else delete process.env.FDS_API_KEY;
});

describe('buildMarketQuoteTool', () => {
  test('schema declares symbol required', () => {
    const spec = buildMarketQuoteTool();
    expect(spec.name).toBe('MarketQuote');
    expect(spec.parameters.required).toEqual(['symbol']);
  });
});

describe('marketQuoteAvailable', () => {
  test('false with no keys', () => {
    expect(marketQuoteAvailable()).toBe(false);
  });

  test('true with EODHD key', () => {
    process.env.EODHD_API_KEY = 'k';
    expect(marketQuoteAvailable()).toBe(true);
  });

  test('true with FDS key for legacy probe compatibility', () => {
    process.env.FDS_API_KEY = 'k';
    expect(marketQuoteAvailable()).toBe(true);
  });
});

describe('dispatchMarketQuote — delegated provider routing', () => {
  test('returns an error only after the keyless delegated provider fails', async () => {
    const r = await dispatchMarketQuote({ symbol: 'AAPL.US' });

    expect(r.isError).toBe(true);
    expect(r.metadata.provider).toBe('none');
    expect(r.output).toContain('조회 실패');
    expect(subprocessCalls).toEqual([['bun', [OMNI, 'quote', 'AAPL.US', '--json']]]);
    expect(tossCalls).toHaveLength(0);
  });

  test('parses raw EODHD-shaped omni stdout on the delegated EODHD route', async () => {
    subprocessOutput = `omni-market v1\n${JSON.stringify({
      provider: 'eodhd',
      code: 'AAPL.US',
      close: 175.32,
      previousClose: 174.07,
      change_p: 0.72,
      high: 176.1,
      volume: 50_000_000,
    })}\n`;

    const r = await dispatchMarketQuote({ symbol: 'AAPL.US' });

    expect(subprocessCalls).toEqual([['bun', [OMNI, 'quote', 'AAPL.US', '--json']]]);
    expect(r.isError).toBeUndefined();
    expect(r.metadata.provider).toBe('eodhd');
    expect(r.metadata.price).toBe(175.32);
    expect(r.metadata.changePct).toBe(0.72);
    expect(r.metadata.volume).toBe(50_000_000);
    expect(r.output).toContain('175.32');
  });

  test('parses a Yahoo-shaped omni stdout on the index route', async () => {
    subprocessOutput = JSON.stringify({
      provider: 'yahoo', close: 5_125.6, previousClose: 5_100, change_p: 0.5, high: 5_140, volume: 2_000_000,
    });

    const r = await dispatchMarketQuote({ symbol: 'KS11.INDX' });

    expect(subprocessCalls).toEqual([['bun', [OMNI, 'quote', 'KS11.INDX', '--json']]]);
    expect(tossCalls).toHaveLength(0);
    expect(r.isError).toBeUndefined();
    expect(r.metadata.provider).toBe('yahoo');
    expect(r.metadata.price).toBe(5_125.6);
  });

  test('uses Toss before omni for a KR live session without API keys', async () => {
    session = { ...session, krLive: true, kr: 'OPEN' };
    tossResult = { last: 318_000, prevClose: 314_000, high: 320_000 };

    const r = await dispatchMarketQuote({ symbol: '005930' });

    expect(tossCalls).toEqual(['005930']);
    expect(subprocessCalls).toHaveLength(0);
    expect(r.metadata.provider).toBe('toss');
    expect(r.metadata.price).toBe(318_000);
  });

  test('falls back from an unavailable KR-live Toss quote to omni', async () => {
    session = { ...session, krLive: true, kr: 'OPEN' };
    subprocessOutput = JSON.stringify({
      provider: 'eodhd', close: 72_000, previousClose: 71_000, change_p: 1.4, high: 72_500,
    });

    const r = await dispatchMarketQuote({ symbol: '005930' });

    expect(tossCalls).toEqual(['005930']);
    expect(subprocessCalls).toEqual([['bun', [OMNI, 'quote', '005930', '--json']]]);
    expect(r.metadata.provider).toBe('eodhd');
    expect(r.metadata.price).toBe(72_000);
  });

  test('fields filter restricts returned subset', async () => {
    subprocessOutput = JSON.stringify({
      provider: 'eodhd', close: 10, previousClose: 9, change_p: 0.1, high: 11, volume: 100,
    });

    const r = await dispatchMarketQuote({ symbol: 'AAPL.US', fields: ['price'] });

    expect(r.metadata.price).toBe(10);
    expect(r.metadata.change).toBeUndefined();
    expect(r.metadata.volume).toBeUndefined();
  });
});

describe('dispatchMarketQuote — validation', () => {
  test('missing symbol rejected', async () => {
    await expect(dispatchMarketQuote({})).rejects.toThrow(/symbol/);
  });

  test('invalid fields entry rejected', async () => {
    await expect(dispatchMarketQuote({ symbol: 'X', fields: ['bogus'] })).rejects.toThrow(/fields/);
  });
});

describe('catalog registration', () => {
  test('market_quote has probe + cleanerFitThanShell', async () => {
    const { nativeToolCatalog } = await import('../src/native-tool-catalog.js');
    const entry = nativeToolCatalog.find(t => t.id === 'market_quote');
    expect(entry).toBeDefined();
    expect(entry!.probe?.kind).toBe('custom');
    expect(entry!.cleanerFitThanShell).toBe(true);
  });
});

afterAll(() => { mock.module('node:child_process', () => realChildProcess); });
