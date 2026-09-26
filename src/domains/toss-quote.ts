// ── 토스증권 시세 클라이언트 (순수 TS · elanous 네이티브) ────────────────
//
// 토스 Open API 로 종목 현재가+세션고가+전일종가. **KR 정규/NXT · US 정규/주간
// 거래(Blue Ocean) 전 세션 라이브** 커버 — Yahoo/EODHD 가 못 주는 NXT·주간거래
// 시세를 준다(한국 투자자가 실제 체결하는 값).
//
// 완전 elanous 소유(파이썬 toss_api.py 의존 제거). 기존 호출부가 동기라 sync 계약
// 유지 위해 HTTP 는 `curl`(시스템 도구) execFileSync. OAuth(client_credentials)
// 토큰은 **파이썬과 동일 공유 캐시 `/tmp/toss_token_cache.json`**(키 token/
// expires_at)를 읽고 써서 재발급으로 상대 토큰을 무효화하지 않는다(client당 1토큰
// gotcha 회피). 자격(TOSSINVEST_*)은 process.env 우선, 없으면 CONATUS/.env.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { conatusEnv } from './conatus-env.js';

const TOSS_BASE = process.env.TOSSINVEST_BASE_URL || 'https://openapi.tossinvest.com';
const TOKEN_CACHE = '/tmp/toss_token_cache.json';

/** TOSSINVEST_ACCOUNT_SEQ — 주문(need_account) 헤더용. env 우선, 없으면 CONATUS/.env. */
function tossAccountSeq(): string {
  return process.env.TOSSINVEST_ACCOUNT_SEQ || conatusEnv().TOSSINVEST_ACCOUNT_SEQ || '';
}

export interface TossQuote {
  /** 최근 1분봉 종가(현재가 근사). */
  last: number;
  /** 오늘 세션 고가(1분봉 highPrice 최대 + 일봉 세션고가). */
  high: number;
  /** 전일 종가(일봉 [1]). 등락률·D-신호 계산용. 없으면 undefined. */
  prevClose?: number;
}

/** TOSSINVEST 자격 — env 우선, 없으면 CONATUS/.env. */
function tossCreds(): { id: string; secret: string } | null {
  let id = process.env.TOSSINVEST_CLIENT_ID || '';
  let secret = process.env.TOSSINVEST_CLIENT_SECRET || '';
  if (!id || !secret) {
    const env = conatusEnv();
    id = id || env.TOSSINVEST_CLIENT_ID || '';
    secret = secret || env.TOSSINVEST_CLIENT_SECRET || '';
  }
  return id && secret ? { id, secret } : null;
}

/** 동기 curl → JSON. body(input) 는 stdin 으로(시크릿 argv 노출 회피). Fail → null. */
function curlJson(url: string, opts: { post?: string; bearer?: string } = {}): any {
  const args = ['-s', '-m', '15'];
  if (opts.bearer) args.push('-H', `Authorization: Bearer ${opts.bearer}`);
  if (opts.post !== undefined) {
    args.push('-X', 'POST', '-H', 'Content-Type: application/x-www-form-urlencoded', '--data', '@-');
  }
  args.push(url);
  try {
    const out = execFileSync('curl', args, {
      input: opts.post ?? '', encoding: 'utf-8', timeout: 20_000, maxBuffer: 4_000_000,
    });
    return JSON.parse(out);
  } catch { return null; }
}

let tokenOverride: string | null | undefined;
/** 테스트용 토큰 주입(공유 /tmp 캐시 무접촉·실 OAuth 회피). undefined 로 호출 = 해제. */
export function _setTossToken(t?: string | null): void { tokenOverride = t; }

/** 공유 캐시(파이썬과 동일 파일·키) 우선, 만료 시 재발급(client_credentials). */
function tossToken(): string | null {
  if (tokenOverride !== undefined) return tokenOverride;
  try {
    if (existsSync(TOKEN_CACHE)) {
      const c = JSON.parse(readFileSync(TOKEN_CACHE, 'utf-8')) as { token?: string; expires_at?: number };
      if (c.token && c.expires_at && c.expires_at > Date.now() / 1000) return c.token;
    }
  } catch { /* fall through */ }
  const creds = tossCreds();
  if (!creds) return null;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.id, client_secret: creds.secret }).toString();
  const j = curlJson(`${TOSS_BASE}/oauth2/token`, { post: body });
  const token = j?.access_token;
  if (!token) return null;
  try {
    writeTossCacheAtomic(JSON.stringify({ token, expires_at: Date.now() / 1000 + (Number(j.expires_in) || 3600) - 30 }));
  } catch { /* best-effort */ }
  return token;
}

/** /tmp 공유 토큰 캐시 원자적 write (C·toss 삼중구현 캐시 계약 통일·2026-07-22). 3개 toss 구현
 *  (elanous/omni-market/kr-flow)이 `/tmp/toss_token_cache.json` 를 공유하므로 비원자 writeFileSync 는
 *  동시 갱신 시 인터리브 손상(레이스). temp 파일 write 후 renameSync(같은 fs=원자적)로 교체. */
function writeTossCacheAtomic(content: string): void {
  const tmp = `${TOKEN_CACHE}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, TOKEN_CACHE);
}

interface TossBar { openPrice: string; highPrice: string; lowPrice: string; closePrice: string; volume: string; timestamp: string }

function candles(sym: string, interval: string, count: number, token: string): TossBar[] {
  const url = `${TOSS_BASE}/api/v1/candles?symbol=${encodeURIComponent(sym)}&interval=${interval}&count=${count}`;
  const j = curlJson(url, { bearer: token });
  return (j?.result?.candles ?? j?.candles ?? []) as TossBar[];
}

const num = (x: unknown): number => Number(x);

// ── 단기 캐시(QoS 방어) ────────────────────────────────────────────────
// 같은 심볼 짧은 시간 중복 조회(한 턴에 D-신호 3종목·KORU·B) 시 토스 rate-limit
// (STOCK ~5 TPS)을 아끼려 TTL 캐시. READ-ONLY 판단이라 수초 지연 무해.
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; q: TossQuote | null }>();
let nowMs: () => number = () => Date.now();
/** 테스트용 시계 주입(결정성). */
export function _setTossClock(fn: () => number): void { nowMs = fn; }

/** 토스 현재가+세션고가+전일종가(US·KR NXT 모두). symbol 은 EODHD 표기
 *  (`KORU.US`)든 순수 티커(`005930`)든 허용 — 거래소 접미 벗겨 토스로.
 *  15초 TTL 캐시(QoS). 동기(sync·기존 호출부 호환). Fail-soft null. */
export function fetchTossQuote(symbol: string): TossQuote | null {
  const sym = symbol.replace(/\.(US|KS|KO|KQ|KRX)$/i, '');
  const hit = cache.get(sym);
  if (hit && nowMs() - hit.at < TTL_MS) return hit.q;
  const q = fetchTossQuoteLive(sym);
  cache.set(sym, { at: nowMs(), q });
  return q;
}

/** 실 토스 조회: 1분봉(현재가+최근고가) + 일봉(세션고가·전일종가) 조합. Fail-soft. */
function fetchTossQuoteLive(sym: string): TossQuote | null {
  const token = tossToken();
  if (!token) return null;
  const m1 = candles(sym, '1m', 200, token);
  const d1 = candles(sym, '1d', 3, token);
  const highs: number[] = [];
  let last: number | null = null;
  let prevClose: number | undefined;
  if (m1.length) {
    last = num(m1[0].closePrice); // DESC → [0] 최신
    for (const b of m1) highs.push(num(b.highPrice));
  }
  if (d1.length) {
    highs.push(num(d1[0].highPrice)); // 오늘 세션 고가
    if (last === null) last = num(d1[0].closePrice);
    if (d1.length >= 2) prevClose = num(d1[1].closePrice);
  }
  if (last === null || !(last > 0) || !highs.length) return null;
  const high = Math.max(...highs);
  return { last, high, prevClose: prevClose && prevClose > 0 ? prevClose : undefined };
}

// ── 주문 WRITE (실돈·toss_api.order_buy/sell 흡수·2026-07-22) ─────────────
// ⚠️ 실주문 primitive. 이 함수 자체엔 정책/한도 게이트 없음 — 게이트는 상위에서 강제:
//    trade-executor(armed/live/maxOrderKrw) + trade-hitl(verify CLEARED + 2단계 승인).
//    여기는 순수 broker WRITE(POST /api/v1/orders). 테스트는 _setTossPoster 로 모킹(실주문 금지).

export type TossOrderSide = 'buy' | 'sell';
export interface TossOrderInput {
  symbol: string; side: TossOrderSide; qty: number;
  /** MARKET(정규장) | LIMIT(넥스트장/장외·price 필수). */
  orderType: 'MARKET' | 'LIMIT'; price?: number;
}
export interface TossOrderResult { ok: boolean; orderId?: string; detail: string }

/** HTTP POST(JSON) 주입 seam — 기본 curl(실). 테스트가 모킹. (url, body, headers) → JSON|null. */
export type TossPoster = (url: string, body: string, headers: Record<string, string>) => any;
const realPoster: TossPoster = (url, body, headers) => {
  const args = ['-s', '-m', '15', '-X', 'POST', '--data', '@-'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  try {
    const out = execFileSync('curl', args, { input: body, encoding: 'utf-8', timeout: 20_000, maxBuffer: 4_000_000 });
    return JSON.parse(out);
  } catch { return null; }
};
let poster: TossPoster = realPoster;
/** 테스트용 주문 POST 주입(실주문 방지). 인자 없이 호출 = 실 poster 복원. */
export function _setTossPoster(fn?: TossPoster): void { poster = fn ?? realPoster; }

/** 실주문 primitive — Toss POST /api/v1/orders (toss_api.order_buy/sell 흡수).
 *  ⚠️ 상위 게이트 통과 후에만 도달해야 함. 자격/계좌 없으면 fail-closed. */
export function tossOrder(o: TossOrderInput): TossOrderResult {
  if (!(o.qty > 0)) return { ok: false, detail: '거부: qty<=0' };
  if (o.orderType === 'LIMIT' && !(o.price && o.price > 0)) return { ok: false, detail: '거부: LIMIT 인데 price 없음' };
  const token = tossToken();
  if (!token) return { ok: false, detail: '거부: 토스 토큰 없음(자격 미설정)' };
  const account = tossAccountSeq();
  if (!account) return { ok: false, detail: '거부: TOSSINVEST_ACCOUNT_SEQ 없음(fail-closed)' };
  const body: Record<string, unknown> = {
    symbol: o.symbol, side: o.side === 'buy' ? 'BUY' : 'SELL', orderType: o.orderType, quantity: o.qty,
  };
  if (o.orderType === 'LIMIT') body.price = o.price;
  const j = poster(`${TOSS_BASE}/api/v1/orders`, JSON.stringify(body), {
    'Authorization': `Bearer ${token}`, 'X-Tossinvest-Account': account, 'Content-Type': 'application/json',
  });
  const orderId = j?.result?.orderId;
  if (!orderId) return { ok: false, detail: `주문 실패/거부: ${JSON.stringify(j ?? {}).slice(0, 160)}` };
  return { ok: true, orderId: String(orderId), detail: `주문 접수 orderId=${orderId}` };
}
