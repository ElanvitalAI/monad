// A2.2 — SEC EDGAR 13F pure parsers (network paths covered by dogfood).

import { describe, test, expect } from 'bun:test';
import { parseInfoTable, secUserAgent, summarize13F, type Filing13F } from '../src/domains/sec-13f.js';

const XML = `<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
 <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><cusip>037833100</cusip>
   <value>2000000000</value><shrsOrPrnAmt><sshPrnamt>1000000</sshPrnamt></shrsOrPrnAmt></infoTable>
 <infoTable><nameOfIssuer>NVIDIA CORP</nameOfIssuer><cusip>67066G104</cusip>
   <value>500000000</value><shrsOrPrnAmt><sshPrnamt>400000</sshPrnamt></shrsOrPrnAmt></infoTable>
</informationTable>`;

describe('parseInfoTable', () => {
  test('parses holdings namespace-agnostically', () => {
    const h = parseInfoTable(XML);
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual({ issuer: 'APPLE INC', cusip: '037833100', value: 2_000_000_000, shares: 1_000_000 });
  });
  test('handles ns-prefixed tags', () => {
    expect(parseInfoTable(XML.replace(/<(\/?)infoTable/g, '<$1ns1:infoTable'))).toHaveLength(2);
  });
});

describe('summarize13F — QoQ money moves', () => {
  const latest: Filing13F = { period: '2026-03-31', filed: '2026-05-15', holdings: [
    { issuer: 'APPLE INC', cusip: 'a', value: 2_000_000_000, shares: 1_000_000 },
    { issuer: 'NVIDIA CORP', cusip: 'n', value: 500_000_000, shares: 400_000 },  // new
  ] };
  const prev: Filing13F = { period: '2025-12-31', filed: '2026-02-14', holdings: [
    { issuer: 'APPLE INC', cusip: 'a', value: 1_000_000_000, shares: 500_000 },   // increased
    { issuer: 'TESLA INC', cusip: 't', value: 300_000_000, shares: 100_000 },     // exited
  ] };

  test('top holdings + new/exited/changed detected', () => {
    const s = summarize13F([latest, prev], { cik: '0000000001', name: 'Test Fund' }) as Record<string, any>;
    expect(s.portfolio_value).toBe('$2.5B');
    expect(s.positions).toBe(2);
    expect(String(s.top_holdings[0])).toMatch(/APPLE/);
    const moves = (s.qoq_moves as string[]).join(' ');
    expect(moves).toMatch(/신규.*NVIDIA/);
    expect(moves).toMatch(/전량매도.*TESLA/);
    expect(moves).toMatch(/▲ APPLE/);
  });

  test('single filing → no-delta note', () => {
    const s = summarize13F([latest], { cik: '1', name: 'X' }) as Record<string, any>;
    expect((s.qoq_moves as string[]).join('')).toMatch(/직전 분기/);
  });
});

describe('secUserAgent — 연락처는 config 에서 온다', () => {
  test('주어진 연락처를 User-Agent 에 싣는다', () => {
    expect(secUserAgent('ops@example.com')).toBe('monad-agent research (ops@example.com)');
  });
  test('연락처가 없으면 설정 방법을 말하며 멈춘다', () => {
    expect(() => secUserAgent('')).toThrow('monad config set finance.secContactEmail');
  });
});
