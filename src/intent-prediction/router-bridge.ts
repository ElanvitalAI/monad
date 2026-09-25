// G2 (2026-05-12) — IntentPrediction tick → OutboundRouter live consumer.
//
// 마지막 wire — F1 #2457 의 buildOutboundEventFromRanking 를 G1 #2462 의
// router (ios-push + web-push 둘 다 등록된 OutboundRouter) 의 입력으로
// 자동 연결. 사용자 세션마다 IntentPredictionService 가 5s tick (또는 error
// immediate) 으로 새 IntentRanking 을 emit → 본 브리지가 OutboundEvent 로
// 변환 후 router.route() 호출.
//
// Cross-ref:
//   src/intent-prediction/index.ts (IntentPredictionService.onRanking)
//   src/intent-prediction/outbound-payload.ts (#2457 builder)
//   src/showroom/outbound/router.ts (OutboundRouter)
//   src/notifications/outbound-boot.ts (#2462 web-push 등록 후 substrate)
//
// Fire-and-forget 모델: router.route() 의 promise 는 await 하지 않는다.
// IntentPredictionService 의 tick scheduler 는 listener 를 순차 동기로
// 호출 — 본 브리지가 await 하면 다른 listener (eventBus fan-out 등) 의
// emit 이 지연된다. router 의 send 실패는 onError 시멘틱 (caller log) 으로
// surface.

import type { IntentPredictionService } from './index.js';
import type { IntentRanking } from './types.js';
import {
  buildOutboundEventFromRanking,
  type BuildOutboundEventOpts,
} from './outbound-payload.js';
import type { OutboundRouter, RoutePreference } from '../showroom/outbound/router.js';

export interface IntentPredictionRouterBridgeOpts {
  service: IntentPredictionService;
  router: OutboundRouter;
  /** F1 builder opts forwarded to `buildOutboundEventFromRanking`.
   *  Use this to control urgency · source · link · title overrides
   *  per surface — for example, lock-screen surfaces probably want
   *  `urgency: 'low'` while a critical agent failure wants 'high'. */
  buildOpts?: BuildOutboundEventOpts;
  /** Routing override (preferOrder / fanOut) — defaults to the
   *  router's DEFAULT_PREFERENCE (live-activity → ios-push → web-push
   *  → …). γ-light dogfood often wants `{ preferOrder: ['web-push'] }`
   *  to skip APNs entirely. */
  routeOverride?: Partial<RoutePreference>;
  /** Caller-supplied error sink — production wires to `debug.log` so
   *  failures land in the same observation surface as other intent-
   *  prediction errors. Default behavior: silently swallow (the
   *  diagnostics counter still ticks). */
  onError?: (err: unknown, ranking: IntentRanking) => void;
}

export interface IntentPredictionRouterBridgeHandle {
  /** Unsubscribe from the ranking stream + stop routing. Idempotent. */
  stop(): void;
  /** Diagnostic snapshot — `dispatched` increments per successful
   *  route() invocation (even when the router skips all channels);
   *  `errors` increments when the builder throws or the router
   *  promise rejects. */
  diagnostics(): { dispatched: number; errors: number };
}

/** Bridge between IntentPredictionService and OutboundRouter.
 *  Returns a handle so the caller (nexus boot) can stop the
 *  subscription during shutdown. The wire is one-way — the bridge
 *  only consumes onRanking emits and never calls back into the
 *  service. */
export function wireIntentPredictionToRouter(
  opts: IntentPredictionRouterBridgeOpts,
): IntentPredictionRouterBridgeHandle {
  let dispatched = 0;
  let errors = 0;
  let stopped = false;
  const unsubscribe = opts.service.onRanking((ranking) => {
    if (stopped) return;
    let event;
    try {
      event = buildOutboundEventFromRanking(ranking, opts.buildOpts);
    } catch (err) {
      errors += 1;
      opts.onError?.(err, ranking);
      return;
    }
    dispatched += 1;
    // Fire-and-forget so the synchronous listener loop in
    // IntentPredictionService isn't blocked by network latency.
    void opts.router.route(event, opts.routeOverride).catch((err) => {
      errors += 1;
      opts.onError?.(err, ranking);
    });
  });
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    },
    diagnostics() {
      return { dispatched, errors };
    },
  };
}
