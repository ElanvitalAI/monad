// W7 Z11.a-1 · OutboundRouter — channel-agnostic dispatch.
// Cf. ROADMAP §4 Z11 S12 outbound · §6.7 finalize routing.

import { isMuted, type DndPolicy } from './dnd-policy.js';
import type {
  ChannelSendResult,
  OutboundChannel,
  OutboundChannelName,
  OutboundEvent,
} from './types.js';

export interface RoutePreference {
  /** Channel priority order. First-available wins unless `fanOut=true`. */
  preferOrder: OutboundChannelName[];
  /** When true, send to every available + un-muted channel. Otherwise
   *  stop after the first successful send. */
  fanOut?: boolean;
}

export const DEFAULT_PREFERENCE: RoutePreference = {
  preferOrder: ['live-activity', 'ios-push', 'web-push', 'watch-card', 'carplay', 'homekit', 'vision-pro'],
};

export interface RouterDeps {
  channels: OutboundChannel[];
  dnd?: DndPolicy;
  preference?: RoutePreference;
  now?: () => number;
}

export interface RouteOutcome {
  delivered: Array<{ channel: OutboundChannelName; channelMessageId?: string }>;
  skipped: Array<{ channel: OutboundChannelName; reason: 'unavailable' | 'muted' | 'failed'; detail?: string }>;
}

export class OutboundRouter {
  private readonly channels = new Map<OutboundChannelName, OutboundChannel>();
  private readonly dnd: DndPolicy | undefined;
  private readonly preference: RoutePreference;

  constructor(deps: RouterDeps) {
    for (const c of deps.channels) this.channels.set(c.name, c);
    this.dnd = deps.dnd;
    this.preference = deps.preference ?? DEFAULT_PREFERENCE;
  }

  registered(): OutboundChannelName[] {
    return Array.from(this.channels.keys());
  }

  async route(
    event: OutboundEvent,
    override?: Partial<RoutePreference>,
  ): Promise<RouteOutcome> {
    const pref: RoutePreference = {
      preferOrder: override?.preferOrder ?? this.preference.preferOrder,
      fanOut: override?.fanOut ?? this.preference.fanOut ?? false,
    };
    const outcome: RouteOutcome = { delivered: [], skipped: [] };

    for (const name of pref.preferOrder) {
      const channel = this.channels.get(name);
      if (!channel) {
        outcome.skipped.push({ channel: name, reason: 'unavailable', detail: 'not-registered' });
        continue;
      }
      if (!channel.available()) {
        outcome.skipped.push({ channel: name, reason: 'unavailable', detail: 'no-receiver' });
        continue;
      }
      if (this.dnd && isMuted(this.dnd, name, event.urgency)) {
        outcome.skipped.push({ channel: name, reason: 'muted' });
        continue;
      }
      const res = await this.send(channel, event);
      if (res.ok) {
        outcome.delivered.push({
          channel: name,
          ...(res.channelMessageId ? { channelMessageId: res.channelMessageId } : {}),
        });
        if (!pref.fanOut) break;
      } else {
        outcome.skipped.push({ channel: name, reason: 'failed', detail: res.reason });
      }
    }

    return outcome;
  }

  private async send(channel: OutboundChannel, event: OutboundEvent): Promise<ChannelSendResult> {
    try {
      return await channel.send(event);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
