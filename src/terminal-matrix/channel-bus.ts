// ── Terminal Matrix — channel bus (Phase T5) ──
//
// Pubsub layer between TerminalInstances. Unlike BroadcastBus
// (fan-out of raw key bytes to PTYs), ChannelBus carries structured
// messages between arbitrary subscribers — terminals, LLM tools,
// UI widgets. A channel name is a free-form string; the common
// convention is `<domain>:<topic>` (e.g. `k8s:logs`, `build:events`).
//
// Typical flow:
//   1. Terminal A runs `kubectl logs -f` — a surface or a wrapper
//      tool tails its output + publishes chunks to `k8s:logs`.
//   2. Terminal B subscribes to `k8s:logs` — an injector writes
//      received chunks into B's PTY stdin (formatted as needed).
//   3. An LLM summariser tool also subscribes; no terminal needed.
//
// ChannelBus itself is transport-neutral — it doesn't spawn tail
// processes or write to PTYs. It only delivers messages to
// subscribers. Surface wiring (T5b) adds the tail/inject hooks on
// top.

export interface ChannelMessage {
  readonly channel: string;
  readonly from: string;          // free-form — terminal id, plugin name, 'llm', etc.
  readonly at: number;
  readonly payload: string | Buffer;
  /** Free-form metadata (e.g. `{ severity: 'warn' }`). Consumers
   *  that don't understand the shape should ignore rather than
   *  fail. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export type ChannelSubscriber = (msg: ChannelMessage) => void;

export interface ChannelSubscription {
  readonly id: number;
  readonly channel: string;
  readonly label?: string;
  unsubscribe(): void;
}

export interface ChannelStats {
  readonly channel: string;
  readonly subscriberCount: number;
  readonly publishedCount: number;
  readonly lastPublishAt: number | null;
  /** U3 — how many messages are currently buffered in the replay
   *  ring for this channel. 0 when replay is disabled or no
   *  messages have been published yet. */
  readonly replayBuffered: number;
}

/** U3 — options for `subscribe`. */
export interface SubscribeOpts {
  /** Free-form label (preserved for debug + subscription listing). */
  label?: string;
  /** When true, every message currently in the channel's replay
   *  buffer is delivered synchronously before `subscribe` returns,
   *  in publish-order. Useful for late joiners who want recent
   *  context. Defaults to false. */
  replay?: boolean;
  /** Cap on how many buffered messages to replay (defaults: all
   *  buffered). Lets consumers say "just the last 10" without
   *  reconfiguring the bus's retention. */
  replayLimit?: number;
}

/** U3 — bus-wide configuration. */
export interface ChannelBusOpts {
  /** Default retention per channel. 0 disables the replay buffer;
   *  subscribe with `{replay: true}` still returns an empty window.
   *  Defaults to 100. */
  defaultReplayLimit?: number;
}

export const DEFAULT_REPLAY_LIMIT = 100;

export class ChannelBus {
  private readonly subs = new Map<string, Map<number, { cb: ChannelSubscriber; label?: string }>>();
  private readonly stats = new Map<string, { published: number; lastAt: number | null }>();
  /** U3 — per-channel ring buffer of recent messages. Sized by
   *  either the per-channel override (set via `setReplayLimit`)
   *  or the bus-level default. */
  private readonly replay = new Map<string, ChannelMessage[]>();
  private readonly replayLimits = new Map<string, number>();
  private readonly defaultReplayLimit: number;
  private nextId = 1;

  constructor(opts: ChannelBusOpts = {}) {
    this.defaultReplayLimit = Math.max(0, opts.defaultReplayLimit ?? DEFAULT_REPLAY_LIMIT);
  }

  subscribe(
    channel: string,
    cb: ChannelSubscriber,
    labelOrOpts?: string | SubscribeOpts,
  ): ChannelSubscription {
    const opts: SubscribeOpts = typeof labelOrOpts === 'string'
      ? { label: labelOrOpts }
      : (labelOrOpts ?? {});
    let perChannel = this.subs.get(channel);
    if (!perChannel) { perChannel = new Map(); this.subs.set(channel, perChannel); }
    const id = this.nextId++;
    perChannel.set(id, { cb, label: opts.label });
    // U3 — replay buffered messages synchronously before returning
    // so the caller sees "backlog" before any future publish(s).
    if (opts.replay) {
      const buf = this.replay.get(channel);
      if (buf && buf.length > 0) {
        const slice = typeof opts.replayLimit === 'number' && opts.replayLimit >= 0
          ? buf.slice(-opts.replayLimit)
          : buf;
        for (const msg of slice) {
          try { cb(msg); } catch { /* isolate */ }
        }
      }
    }
    return {
      id,
      channel,
      label: opts.label,
      unsubscribe: () => {
        const m = this.subs.get(channel);
        if (!m) return;
        m.delete(id);
        if (m.size === 0) this.subs.delete(channel);
      },
    };
  }

  /** U3 — override the replay buffer size for a specific channel.
   *  Setting 0 disables replay for that channel (existing buffer
   *  dropped). Useful for high-volume topics where default 100
   *  would waste memory. */
  setReplayLimit(channel: string, limit: number): void {
    const clamped = Math.max(0, Math.floor(limit));
    if (clamped === 0) {
      this.replayLimits.set(channel, 0);
      this.replay.delete(channel);
      return;
    }
    this.replayLimits.set(channel, clamped);
    // Trim existing buffer immediately so the new cap takes effect.
    const buf = this.replay.get(channel);
    if (buf && buf.length > clamped) {
      this.replay.set(channel, buf.slice(buf.length - clamped));
    }
  }

  publish(channel: string, msg: Omit<ChannelMessage, 'channel' | 'at'> & { at?: number }): number {
    const full: ChannelMessage = {
      channel,
      from: msg.from,
      at: msg.at ?? Date.now(),
      payload: msg.payload,
      meta: msg.meta,
    };
    const stat = this.stats.get(channel) ?? { published: 0, lastAt: null };
    stat.published += 1;
    stat.lastAt = full.at;
    this.stats.set(channel, stat);
    // U3 — append to ring buffer (bounded by per-channel or default
    // limit). Disabled when limit is explicitly 0.
    const limit = this.replayLimits.get(channel) ?? this.defaultReplayLimit;
    if (limit > 0) {
      const buf = this.replay.get(channel) ?? [];
      buf.push(full);
      if (buf.length > limit) buf.splice(0, buf.length - limit);
      this.replay.set(channel, buf);
    }
    const perChannel = this.subs.get(channel);
    if (!perChannel || perChannel.size === 0) return 0;
    let delivered = 0;
    for (const { cb } of perChannel.values()) {
      try { cb(full); delivered += 1; } catch { /* isolate failures */ }
    }
    return delivered;
  }

  /** Enumerate channels with at least one subscriber OR at least
   *  one published message (so idle topics + frequent fire-and-forget
   *  publishes both show up in /term channel list). */
  channels(): string[] {
    const seen = new Set<string>();
    for (const c of this.subs.keys()) seen.add(c);
    for (const c of this.stats.keys()) seen.add(c);
    return [...seen].sort();
  }

  statsFor(channel: string): ChannelStats {
    const perChannel = this.subs.get(channel);
    const stat = this.stats.get(channel);
    const buf = this.replay.get(channel);
    return {
      channel,
      subscriberCount: perChannel?.size ?? 0,
      publishedCount: stat?.published ?? 0,
      lastPublishAt: stat?.lastAt ?? null,
      replayBuffered: buf?.length ?? 0,
    };
  }

  /** U3 — snapshot the replay buffer for a channel without
   *  subscribing. Returns [] when the buffer is empty / disabled. */
  snapshot(channel: string, limit?: number): readonly ChannelMessage[] {
    const buf = this.replay.get(channel);
    if (!buf || buf.length === 0) return [];
    if (typeof limit === 'number' && limit >= 0) {
      return buf.slice(-limit);
    }
    return buf.slice();
  }

  /** Testing / teardown helper — drops every subscriber and
   *  resets counters + replay buffers. Does NOT notify subscribers. */
  reset(): void {
    this.subs.clear();
    this.stats.clear();
    this.replay.clear();
    this.replayLimits.clear();
    this.nextId = 1;
  }
}
