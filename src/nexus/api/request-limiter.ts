// ── 전역 요청 리미터 (게시 라우트 rate-limit) — 미션 e4f97b external-markdown ──
// #5163 createGlobalRequestLimiter 를 http-server 에서 독립 모듈로 추출(orphan 배선 마무리·2026-07-23).
// clock 주입 결정론 경계 테스트 가능. 게시(POST) 라우트가 acquire() 로 rate/concurrency 제한.

export const PUBLISH_RATE_WINDOW_MS = 60_000;
export const PUBLISH_MAX_REQUESTS_PER_WINDOW = 300;
export const PUBLISH_MAX_CONCURRENT_REQUESTS = 32;

export interface RequestPermit {
  ok: true;
  release: () => void;
}

export interface RequestRejection {
  ok: false;
  reason: 'rate' | 'concurrency';
  retryAfterSeconds: number;
  response: Response;
}

export type RequestLimiterResult = RequestPermit | RequestRejection;

export interface GlobalRequestLimiter {
  acquire(): RequestLimiterResult;
  stats(): { active: number; windowCount: number; windowStart: number };
}

export interface GlobalRequestLimiterOptions {
  now?: () => number;
  maxRequestsPerWindow?: number;
  windowMs?: number;
  maxConcurrent?: number;
}

function rateLimitResponse(reason: 'rate' | 'concurrency', retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'rate-limited', reason }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(retryAfterSeconds),
        'access-control-allow-origin': '*',
      },
    },
  );
}

export function createGlobalRequestLimiter(
  options: GlobalRequestLimiterOptions = {},
): GlobalRequestLimiter {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? PUBLISH_RATE_WINDOW_MS;
  const maxRequests = options.maxRequestsPerWindow ?? PUBLISH_MAX_REQUESTS_PER_WINDOW;
  const maxConcurrent = options.maxConcurrent ?? PUBLISH_MAX_CONCURRENT_REQUESTS;

  let active = 0;
  let windowStart = now();
  let windowCount = 0;

  function rollWindow(t: number): void {
    if (t - windowStart >= windowMs) {
      windowStart = t;
      windowCount = 0;
    }
  }

  return {
    acquire(): RequestLimiterResult {
      const t = now();
      rollWindow(t);
      if (windowCount >= maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - t) / 1000));
        return {
          ok: false,
          reason: 'rate',
          retryAfterSeconds,
          response: rateLimitResponse('rate', retryAfterSeconds),
        };
      }
      if (active >= maxConcurrent) {
        const retryAfterSeconds = 1;
        return {
          ok: false,
          reason: 'concurrency',
          retryAfterSeconds,
          response: rateLimitResponse('concurrency', retryAfterSeconds),
        };
      }
      windowCount += 1;
      active += 1;
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          active -= 1;
        },
      };
    },
    stats() {
      return { active, windowCount, windowStart };
    },
  };
}
