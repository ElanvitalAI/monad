/**
 * TwelveData Provider — US 인트라데이/실시간 특화 (보조 지표).
 *
 * EODHD(백본·글로벌 EOD)를 대체하지 않고, EODHD 가 약한 한 지점만 메운다:
 * **미국 상장 종목/ETF 의 실시간 quote + 인트라데이 시계열**. 결제된 Grow
 * 플랜은 US 실시간이 강점이고 **한국 개별종목은 Pro/Venture 부터라 원천
 * 차단**(005930 → 404 "available starting with the Pro or Venture plan")이다.
 * 따라서 supports() 를 **US 심볼 + quote/intraday 로만** 좁힌다. 한국/지수/
 * FX/글로벌 EOD 는 절대 이 프로바이더로 오지 않는다(→ eodhd/yahoo 유지).
 *
 * 라우터 우선순위: yahoo → **twelvedata** → eodhd → fds. US quote/intraday 는
 * TwelveData 가 선점(실시간), 실패하면 eodhd 로 fallback. 나머지는 불변.
 */

import { hasEnv, requireEnv } from '../env.js';
import type { Provider, Command, ApiOptions } from '../types.js';

const BASE = 'https://api.twelvedata.com';

// 이 프로바이더가 다루는 명령 — US 실시간/인트라데이만. EOD·펀더멘털·뉴스
// 등은 EODHD 백본이 담당(일관성). technical 은 render shape 차이로 보류.
const SUPPORTED: Set<Command> = new Set(['quote', 'intraday']);

/** US 상장 심볼만 허용. `.US` 접미(EODHD 표기) 또는 접미 없는 순수 티커.
 *  `.KO/.KQ/.KRX/.FOREX/.INDX` 등 비-US 접미는 거부(→ eodhd/yahoo). */
function isUsSymbol(sym: string | undefined): boolean {
  if (!sym) return false;
  const dot = sym.lastIndexOf('.');
  if (dot >= 0) return sym.slice(dot + 1).toUpperCase() === 'US';
  return /^[A-Za-z][A-Za-z0-9]*$/.test(sym);
}

/** EODHD 표기(`SOXL.US`) → TwelveData 표기(`SOXL`). */
function tdSymbol(target: string): string {
  return target.replace(/\.US$/i, '');
}

async function tdGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const apiKey = requireEnv('TWELVEDATA_API_KEY');
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TwelveData ${res.status}: ${res.statusText}`);
  const j = await res.json();
  // TD 는 200 으로 에러를 실어보냄: { status:'error', code, message } → throw 하여
  // 라우터가 eodhd 로 fallback 하게 한다.
  if (j && (j.status === 'error' || (typeof j.code === 'number' && j.code >= 400))) {
    throw new Error(`TwelveData error ${j.code ?? ''}: ${String(j.message ?? '').slice(0, 120)}`);
  }
  return j;
}

const n = (x: unknown): number => Number(x);

/** TD /quote → EODHD real-time 와 동일 필드 shape(code/close/previousClose/
 *  change_p …, 전부 number). 기존 render 'quote' + `--json` 소비자(finance
 *  도구 omniQuote 등)와 계약 호환. */
function mapQuote(target: string, j: any) {
  return {
    code: target,
    timestamp: n(j.timestamp),
    open: n(j.open),
    high: n(j.high),
    low: n(j.low),
    close: n(j.close),
    volume: n(j.volume),
    previousClose: n(j.previous_close),
    change: n(j.change),
    change_p: n(j.percent_change),
    is_market_open: !!j.is_market_open,
  };
}

/** TD interval 매핑(omni ApiOptions.interval → TD). 기본 5min. */
function tdInterval(iv?: string): string {
  return iv === '1m' ? '1min' : iv === '1h' ? '1h' : '5min';
}

/** TD /time_series(desc) → PriceBar[] 오름차순(EODHD intraday 와 동일 shape). */
function mapSeries(j: any): Array<{ datetime: string; open: number; high: number; low: number; close: number; volume: number }> {
  const values = Array.isArray(j?.values) ? j.values : [];
  return values
    .map((v: any) => ({
      datetime: v.datetime,
      open: n(v.open), high: n(v.high), low: n(v.low), close: n(v.close), volume: n(v.volume),
    }))
    .reverse();
}

export const twelvedata: Provider = {
  name: 'twelvedata',

  available(): boolean {
    return hasEnv('TWELVEDATA_API_KEY');
  },

  // US 심볼 + quote/intraday 만. 한국·지수·FX·EOD 는 거부 → eodhd/yahoo.
  supports(command: Command, symbol?: string): boolean {
    return SUPPORTED.has(command) && isUsSymbol(symbol);
  },

  async execute(command: Command, target: string, opts: ApiOptions) {
    const sym = tdSymbol(target);
    switch (command) {
      case 'quote': {
        const j = await tdGet('/quote', { symbol: sym });
        return { data: mapQuote(target, j), renderKey: 'quote' };
      }
      case 'intraday': {
        const params: Record<string, string> = {
          symbol: sym,
          interval: tdInterval(opts.interval),
          outputsize: String(opts.limit ?? 100),
        };
        const j = await tdGet('/time_series', params);
        return { data: mapSeries(j), renderKey: 'intraday' };
      }
      default:
        throw new Error(`twelvedata: unsupported command ${command}`);
    }
  },
};
