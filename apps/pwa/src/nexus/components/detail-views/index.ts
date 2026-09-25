// PWA · TabDetail kind-dispatch barrel (Phase N-4 PR π)
//
// Surface-unification v2.2 V2.2-6 v2 (2026-05-11) — `scheduler` kind +
// `SchedulerDetail` import retired together with the dashboard scheduler
// view + `/v1/scheduler*` endpoint. The NEXUS sidebar 'scheduler' kind
// (apps/pwa/src/nexus/types.ts) is also retired in this PR.

import type { ComponentType } from 'react';
import type { NexusTabKind, NexusTabState } from '../../types';
import { ChatDetail } from './chat-detail';
import { WebtermDetail } from './webterm-detail';
import { DaemonDetail } from './daemon-detail';
import { PwaHostDetail } from './pwa-host-detail';
import { ChannelBotDetail } from './channel-bot-detail';

export type DetailComponent = ComponentType<{ tab: NexusTabState }>;

export const DETAIL_BY_KIND: Record<NexusTabKind, DetailComponent> = {
  chat: ChatDetail,
  webterm: WebtermDetail,
  daemon: DaemonDetail,
  'pwa-host': PwaHostDetail,
  'channel-bot': ChannelBotDetail,
};

export function pickDetailComponent(kind: NexusTabKind): DetailComponent {
  return DETAIL_BY_KIND[kind];
}

export {
  ChatDetail,
  WebtermDetail,
  DaemonDetail,
  PwaHostDetail,
  ChannelBotDetail,
};
