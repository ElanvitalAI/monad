// F2 (2026-05-12) — Web Push as an OutboundChannel.
//
// 기존 `src/web-push/sender.ts` (sendPushToAll) 가 ad-hoc 호출 surface 였음.
// 본 채널이 그 sender + `src/web-push/subscriptions.ts` 의 listSubscriptions()
// 를 OutboundChannel 인터페이스로 래핑 → OutboundRouter 가 ios-push 와
// 동일한 layer 에서 web-push 도 라우팅. Chrome desktop · Firefox · Safari
// macOS · iOS 16.4+ home-screen PWA 모두 동일 W3C Push 프로토콜 위 동작.
//
// PushSubscription 은 endpoint URL + p256dh/auth key 의 복합체이므로
// 본 채널은 tokenStore (raw push token 용) 가 아닌 `src/web-push/
// subscriptions.ts` 의 dedicated store 를 source-of-truth 로 사용한다.
// 그래서 deps 는 `sender` + `subscriptionCount` 두 seam 만 노출 — 둘 다
// optional · 미주입 시 production sendPushToAll/listSubscriptions 호출.
//
// Cross-ref:
//   src/web-push/sender.ts (PushPayload · sendPushToAll · PushAction)
//   src/web-push/subscriptions.ts (listSubscriptions)
//   src/showroom/outbound/types.ts (OutboundChannel · OutboundEvent)

import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundEvent,
} from '../types.js';
import {
  sendPushToAll,
  type PushAction,
  type PushPayload,
  type SendPushResult,
} from '../../../web-push/sender.js';
import { listSubscriptions } from '../../../web-push/subscriptions.js';

/** Test seam — production wraps `sendPushToAll`. */
export interface WebPushSender {
  sendPushToAll(payload: PushPayload): Promise<SendPushResult>;
}

export interface WebPushChannelDeps {
  /** Override sender — defaults to the production sendPushToAll. */
  sender?: WebPushSender;
  /** Override availability check — defaults to listSubscriptions().length. */
  subscriptionCount?: () => number;
}

/** Translate OutboundEvent → PushPayload. Pure · exported for unit
 *  testing the mapping without exercising the sender. Actions are
 *  optional · pass through when `event.payload.actions` is a
 *  well-formed `PushAction[]`. Web Push spec caps actions at 5
 *  (Chrome); Safari ignores the array entirely. */
export function buildWebPushPayload(event: OutboundEvent): PushPayload {
  const actions = readActionsFromPayload(event.payload);
  return {
    title: event.title,
    ...(event.body ? { body: event.body } : {}),
    ...(event.link ? { url: event.link } : {}),
    tag: event.source,
    data: {
      eventId: event.id,
      urgency: event.urgency,
      ts: event.ts,
      ...(event.payload ?? {}),
    },
    ...(actions ? { actions } : {}),
  };
}

function readActionsFromPayload(payload: OutboundEvent['payload']): PushAction[] | undefined {
  if (!payload) return undefined;
  const raw = (payload as { actions?: unknown }).actions;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: PushAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as { action?: unknown; title?: unknown };
    if (typeof r.action !== 'string' || typeof r.title !== 'string') continue;
    out.push({ action: r.action, title: r.title });
    if (out.length === 5) break;  // Chrome cap.
  }
  return out.length > 0 ? out : undefined;
}

export function createWebPushChannel(deps: WebPushChannelDeps = {}): OutboundChannel {
  const sender = deps.sender ?? { sendPushToAll };
  const subscriptionCount = deps.subscriptionCount ?? (() => listSubscriptions().length);
  return {
    name: 'web-push',
    available: () => subscriptionCount() > 0,
    async send(event: OutboundEvent): Promise<ChannelSendResult> {
      const payload = buildWebPushPayload(event);
      const result = await sender.sendPushToAll(payload);
      if (result.attempted === 0) {
        return { ok: false, reason: 'no-subscriptions' };
      }
      if (result.delivered === 0) {
        const reasons = result.errors.map((e) => `${e.id}: ${e.reason}`).join('; ');
        return {
          ok: false,
          reason: `all-failed: ${reasons || 'no-detail'}`,
        };
      }
      // Channel message id encodes the delivery ratio so callers /
      // dashboards can detect partial degradation (e.g. 3/5 = 2
      // subscribers rejected).
      return {
        ok: true,
        channelMessageId: `web-push:${event.id}:${result.delivered}/${result.attempted}`,
      };
    },
  };
}
