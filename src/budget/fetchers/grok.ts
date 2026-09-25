// Grok budget fetcher adapter.
//
// Reuses `fetchGrokUsage` (src/grok/usage.ts). Existing subscription token
// only. Does not infer a subscription-pool remaining/reset and does not
// scrape a web page. Credit figures stay on the credits axis — they are
// never written into RateWindow.remainingPercent.

import {
  fetchGrokUsage,
  grokUsageToCreditAxis,
  type GrokUsage,
} from '../../grok/usage.js';
import type { ProviderFetcher } from '../usage-store.js';
import type { CreditsInfo, UsageProvider, UsageSnapshot } from '../types.js';

export interface GrokFetcherOpts {
  /** Test seam — same injected fetch as `fetchGrokUsage`. */
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export function createGrokFetcher(opts: GrokFetcherOpts = {}): ProviderFetcher {
  return {
    async fetch(): Promise<UsageSnapshot> {
      const result = await fetchGrokUsage({
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (result.status !== 'ok') {
        throw new Error(grokFetchFailureMessage(result.status, result.status === 'error' ? result.detail : undefined));
      }
      return grokUsageToSnapshot(result.usage);
    },
  };
}

export function grokUsageToSnapshot(usage: GrokUsage, fetchedAt: number = Date.now()): UsageSnapshot {
  const credits = creditsFromGrokUsage(usage);
  return {
    provider: 'grok' as UsageProvider,
    // ⛔ 크레딧 사용률을 구독 창 잔량처럼 보이게 하는 RateWindow 를 만들지 않는다.
    windows: [],
    ...(credits ? { credits } : {}),
    fetchedAt,
    source: 'oauth-api',
  };
}

function creditsFromGrokUsage(usage: GrokUsage): CreditsInfo | undefined {
  const axis = grokUsageToCreditAxis(usage);
  if (axis.prepaidBalance === null && axis.used === null && axis.monthlyLimit === null) return undefined;
  return {
    balance: axis.prepaidBalance ?? 0,
    hasCredits: axis.prepaidBalance !== null && axis.prepaidBalance > 0,
    unlimited: false,
  };
}

function grokFetchFailureMessage(
  status: 'no-subscription' | 'unauthorized' | 'error',
  detail?: string,
): string {
  if (status === 'no-subscription') return 'grok: no-subscription';
  if (status === 'unauthorized') return 'grok: unauthorized';
  return `grok: error${detail ? ` — ${detail}` : ''}`;
}
