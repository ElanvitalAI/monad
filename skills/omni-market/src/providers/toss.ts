/**
 * Toss(토스증권) Provider — 한국 브로커 전 세션 라이브 시세.
 *
 * 왜: Yahoo/EODHD 는 KRX NXT(넥스트트레이드 08-09시·15:30-20시)와 US 주간거래
 * (Blue Ocean·한국 낮)를 커버하지 못해, 그 시간엔 직전 종가를 "현재가"로 반환한다
 * (예: 삼성 NXT 프리에 정규장 종가 309,500 을 실시간인 양 제시하는 버그). 토스
 * Open API 는 KR 정규·NXT · US 정규·주간거래를 **모두 라이브**로 준다(한국 투자자가
 * 실제 체결하는 값). 따라서 quote(현재가)는 토스를 1순위로 라우팅한다.
 *
 * 인증: /oauth2/token(client_credentials). 토큰은 **파이썬(toss_api.py)과 동일한
 * 공유 캐시 `/tmp/toss_token_cache.json`** 를 읽고 쓴다(같은 키 token/expires_at) →
 * 재발급으로 상대 토큰을 무효화하지 않는다(client당 1토큰 gotcha 회피). 자격은
 * 환경변수 우선, 없으면 CONATUS/.env 에서 로드.
 *
 * 커버: equity/ETF 의 quote 만(.KS/.KO/.KQ/US·순수티커). 지수(.INDX)·FX(.FOREX)·
 * eod/fundamentals 등은 지원 안 함 → yahoo/eodhd 로. 실패 시 router 가 fallback.
 */

import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Provider, Command, ApiOptions } from '../types.js';

const TOSS_BASE = process.env.TOSSINVEST_BASE_URL || 'https://openapi.tossinvest.com';
const TOKEN_CACHE = '/tmp/toss_token_cache.json';
// Conatus creds .env 경로 — 해석 순서 = env CONATUS_ENV → ~/.monad/conatus/.env(monad 소유) → CONATUS_DIR/.env.
//   (2026-09-25 공개 준비: 한 사람의 개인 프로젝트 폴더 후보 둘을 뺐다 — 그 기계는 ~/.monad/conatus/.env 가 1순위라 동작이 같다.)
const CONATUS_ENV_CANDIDATES = [
  process.env.CONATUS_ENV || '',
  join(homedir(), '.monad', 'conatus', '.env'),                             // ★ monad 소유 우선(Conatus dir 무관)
  process.env.CONATUS_DIR ? join(process.env.CONATUS_DIR, '.env') : '',
].filter(Boolean);
function conatusEnvPath(): string | null {
  return CONATUS_ENV_CANDIDATES.find(p => existsSync(p)) ?? null;
}

function tossCreds(): { id: string; secret: string } | null {
  let id = process.env.TOSSINVEST_CLIENT_ID || '';
  let secret = process.env.TOSSINVEST_CLIENT_SECRET || '';
  const envPath = conatusEnvPath();
  if ((!id || !secret) && envPath) {
    for (const raw of readFileSync(envPath, 'utf-8').split('\n')) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k === 'TOSSINVEST_CLIENT_ID' && !id) id = v;
      if (k === 'TOSSINVEST_CLIENT_SECRET' && !secret) secret = v;
    }
  }
  return id && secret ? { id, secret } : null;
}

async function tossToken(): Promise<string | null> {
  // 공유 캐시 우선(파이썬과 동일 파일·키).
  try {
    if (existsSync(TOKEN_CACHE)) {
      const c = JSON.parse(readFileSync(TOKEN_CACHE, 'utf-8')) as { token?: string; expires_at?: number };
      if (c.token && c.expires_at && c.expires_at > Date.now() / 1000) return c.token;
    }
  } catch { /* fall through to fetch */ }
  const creds = tossCreds();
  if (!creds) return null;
  const res = await fetch(`${TOSS_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.id, client_secret: creds.secret }),
  });
  if (!res.ok) return null;
  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  try {
    // 원자적 write(temp+rename) — monad/kr-flow 와 공유하는 /tmp 캐시라 동시 갱신 인터리브 손상 방지(C).
    const tmp = `${TOKEN_CACHE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ token: j.access_token, expires_at: Date.now() / 1000 + (j.expires_in ?? 3600) - 30 }));
    renameSync(tmp, TOKEN_CACHE);
  } catch { /* cache write best-effort */ }
  return j.access_token;
}

async function candles(sym: string, interval: string, count: number, token: string): Promise<any[]> {
  const url = new URL(`${TOSS_BASE}/api/v1/candles`);
  url.searchParams.set('symbol', sym);
  url.searchParams.set('interval', interval);
  url.searchParams.set('count', String(count));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`toss candles ${res.status}`);
  const j = await res.json() as any;
  return (j?.result?.candles ?? j?.candles ?? []) as any[];
}

/** equity/ETF 만: US·순수티커 또는 KR(.KS/.KO/.KQ/.KRX). 지수/FX 는 제외. */
function isTossSymbol(sym?: string): boolean {
  if (!sym) return false;
  const dot = sym.lastIndexOf('.');
  if (dot >= 0) return ['US', 'KS', 'KO', 'KQ', 'KRX'].includes(sym.slice(dot + 1).toUpperCase());
  return /^[0-9A-Za-z]+$/.test(sym);
}
function tossSym(target: string): string {
  return target.replace(/\.(US|KS|KO|KQ|KRX)$/i, '');
}

const num = (x: unknown): number => Number(x);

export const toss: Provider = {
  name: 'toss',

  available(): boolean {
    return !!tossCreds();
  },

  supports(command: Command, symbol?: string): boolean {
    return command === 'quote' && isTossSymbol(symbol);
  },

  async execute(_command: Command, target: string, _opts: ApiOptions) {
    const token = await tossToken();
    if (!token) throw new Error('toss: no token (creds/oauth 실패)');
    const sym = tossSym(target);
    // 1분봉(최신 현재가) + 일봉(세션 OHLC·전일종가) 병렬.
    const [m1, d1] = await Promise.all([
      candles(sym, '1m', 1, token).catch(() => [] as any[]),
      candles(sym, '1d', 2, token).catch(() => [] as any[]),
    ]);
    const today = d1[0] ?? {};
    const last = m1[0] ? num(m1[0].closePrice) : num(today.closePrice);
    const prevClose = d1[1] ? num(d1[1].closePrice) : num(today.closePrice);
    if (!(last > 0)) throw new Error('toss: 시세 없음(세션 밖·심볼)');
    const change = prevClose > 0 ? last - prevClose : 0;
    const change_p = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      data: {
        code: target,
        timestamp: Math.floor(Date.now() / 1000),
        open: num(today.openPrice) || last,
        high: num(today.highPrice) || last,
        low: num(today.lowPrice) || last,
        close: last,
        volume: num(today.volume) || 0,
        previousClose: prevClose || last,
        change,
        change_p,
        session: 'toss-live', // 토스 전 세션 라이브(NXT/주간거래 포함)
      },
      renderKey: 'quote',
    };
  },
};
