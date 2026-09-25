// PWA · TabDetail kind-dispatch tests (Phase N-4 PR π)
//
// Surface-unification v2.2 V2.2-6 v2 (2026-05-11) — 'scheduler' kind +
// SchedulerDetail entry retired together with the dashboard scheduler
// view + server `/v1/scheduler*` endpoint group.

import { describe, test, expect } from 'bun:test';
import { DETAIL_BY_KIND, pickDetailComponent } from './detail-views';
import { ChatDetail } from './detail-views/chat-detail';
import { WebtermDetail } from './detail-views/webterm-detail';
import { DaemonDetail } from './detail-views/daemon-detail';
import { PwaHostDetail } from './detail-views/pwa-host-detail';
import { ChannelBotDetail } from './detail-views/channel-bot-detail';

describe('detail-views kind dispatch', () => {
  test('every kind maps to a defined component', () => {
    expect(DETAIL_BY_KIND.chat).toBe(ChatDetail);
    expect(DETAIL_BY_KIND.webterm).toBe(WebtermDetail);
    expect(DETAIL_BY_KIND.daemon).toBe(DaemonDetail);
    expect(DETAIL_BY_KIND['pwa-host']).toBe(PwaHostDetail);
    expect(DETAIL_BY_KIND['channel-bot']).toBe(ChannelBotDetail);
  });

  test('pickDetailComponent returns the same as DETAIL_BY_KIND', () => {
    for (const kind of ['chat', 'webterm', 'daemon', 'pwa-host', 'channel-bot'] as const) {
      expect(pickDetailComponent(kind)).toBe(DETAIL_BY_KIND[kind]);
    }
  });

  test('all 5 kinds covered (no missing entries)', () => {
    expect(Object.keys(DETAIL_BY_KIND).sort()).toEqual([
      'channel-bot', 'chat', 'daemon', 'pwa-host', 'webterm',
    ]);
  });
});
