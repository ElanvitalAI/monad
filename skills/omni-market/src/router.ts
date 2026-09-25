/**
 * Provider Router — selects providers and executes with fallback.
 *
 * Priority: eodhd (global) → fds (US deep fundamentals)
 * On failure, automatically tries the next available provider.
 */

import { yahoo } from './providers/yahoo.js';
import { toss } from './providers/toss.js';
import { twelvedata } from './providers/twelvedata.js';
import { eodhd } from './providers/eodhd.js';
import { fds } from './providers/fds.js';
import type { Provider, Command, ApiOptions } from './types.js';

// Provider order = priority. First available+supporting provider wins.
// yahoo is first BUT only supports() index targets on eod/quote — so it owns
// global indices (EODHD returns empty 200 for non-US/KR indices, which the
// throw-based fallback below can't detect).
// eodhd is the backbone: on a top EODHD tier it already delivers US real-time,
// intraday (deeper history + extended hours), technical indicators AND full
// Korean coverage — empirically ≥ TwelveData Grow on every axis. So eodhd is
// PRIMARY for US quote/intraday too.
// twelvedata sits AFTER eodhd as a US-only FAILOVER (its supports() hard-
// refuses non-US since Grow gates Korea to Pro/Venture). It only activates if
// eodhd throws — a modest disaster-recovery backup for the money-adjacent path,
// never a downgrade of EODHD's richer intraday.
// toss 는 equity/ETF quote 1순위 — **yahoo 보다 앞**(yahoo 가 .KS 를 잡아 정규장
// 종가를 반환하던 것을 선점). toss.supports=quote+equity 라 지수(.INDX)는 통과 →
// yahoo, eod/펀더멘털은 eodhd. toss 실패(세션 밖·심볼)면 throw→아래로 fallback.
const ALL_PROVIDERS: Provider[] = [toss, yahoo, eodhd, twelvedata, fds];

export interface RouteResult {
  provider: string;
  data: any;
  renderKey: string;
  fallbackUsed: boolean;
  errors: string[];
}

/**
 * Route a command to the best available provider, with automatic fallback.
 */
export async function route(command: Command, target: string, opts: ApiOptions): Promise<RouteResult> {
  const candidates = ALL_PROVIDERS.filter(p => p.available() && p.supports(command, target));

  if (candidates.length === 0) {
    const allNames = ALL_PROVIDERS.map(p => `${p.name}(available=${p.available()}, supports=${p.supports(command, target)})`);
    throw new Error(`No provider available for "${command} ${target}". Providers: ${allNames.join(', ')}`);
  }

  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    try {
      const result = await p.execute(command, target, opts);
      return {
        provider: p.name,
        data: result.data,
        renderKey: result.renderKey,
        fallbackUsed: i > 0,
        errors,
      };
    } catch (err: any) {
      const msg = `[${p.name}] ${err.message}`;
      errors.push(msg);
      console.error(`  ⚠ ${msg}`);
      if (i < candidates.length - 1) {
        console.error(`  → fallback to ${candidates[i + 1].name}...`);
      }
    }
  }

  throw new Error(`All providers failed for "${command} ${target}":\n${errors.join('\n')}`);
}

/**
 * List available providers and their status.
 */
export function listProviders(): { name: string; available: boolean }[] {
  return ALL_PROVIDERS.map(p => ({ name: p.name, available: p.available() }));
}
