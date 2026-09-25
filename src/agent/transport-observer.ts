// H5 Phase 2 · Transport observer.
//
// Subscribes to a session's PTY output via the pty-shell event bus,
// routes each chunk through the channel router, and keeps per-channel
// accumulators that the snapshot store can fold into a capture.
//
// Intentionally read-only: the observer does not interfere with the
// session's own output rendering (the VW pty-tail pane still runs).
// Multiple observers can attach to the same session safely — they
// are independent subscribers.

import { onPtyEvent, type PtyEvent } from '../pty-shell/registry.js';
import type { ChannelName, ChannelRouter, ChannelContext } from './channel-router.js';
import type { EmbodiedAgentSession } from './embodiment.js';

export interface TransportObserverOpts {
  readonly router: ChannelRouter;
  readonly adapterId: string;
  /** Keep only the last N bytes per channel (rolling). Default 64 KB. */
  readonly maxBytesPerChannel?: number;
}

const DEFAULT_MAX_BYTES_PER_CHANNEL = 64 * 1024;

export interface ChannelSnapshot {
  readonly [channel: string]: string;
}

export class TransportObserver {
  private readonly ptyId: string;
  private readonly router: ChannelRouter;
  private readonly ctx: ChannelContext;
  private readonly maxBytes: number;
  private readonly buffers = new Map<ChannelName, string>();
  private disposePty: (() => void) | null;

  constructor(ptyId: string, opts: TransportObserverOpts) {
    this.ptyId = ptyId;
    this.router = opts.router;
    this.ctx = { adapterId: opts.adapterId };
    this.maxBytes = opts.maxBytesPerChannel ?? DEFAULT_MAX_BYTES_PER_CHANNEL;
    this.disposePty = onPtyEvent((ev: PtyEvent) => {
      if (ev.type !== 'output' || ev.id !== this.ptyId) return;
      this.ingest(ev.chunk);
    });
  }

  /** Test seam / capture-driven ingestion · also used by the pty-event
   *  handler above. */
  ingest(chunk: string): void {
    const match = this.router.classify(chunk, this.ctx);
    const prev = this.buffers.get(match.channel) ?? '';
    let next = prev + chunk;
    if (next.length > this.maxBytes) {
      next = next.slice(next.length - this.maxBytes);
    }
    this.buffers.set(match.channel, next);
  }

  /** Snapshot the per-channel accumulators. Returns a plain record
   *  suitable for embedding in a `TtySnapshot.channels` field. */
  snapshotChannels(): ChannelSnapshot {
    const out: Record<string, string> = {};
    for (const [channel, buf] of this.buffers) {
      if (buf.length > 0) out[channel] = buf;
    }
    return out;
  }

  /** Available channel tags on this session (for advisory surfacing
   *  via `EmbodiedAgentSession.snapshotChannels?` field). */
  activeChannels(): readonly string[] {
    return [...this.buffers.keys()];
  }

  dispose(): void {
    if (this.disposePty) {
      this.disposePty();
      this.disposePty = null;
    }
    this.buffers.clear();
  }
}

// ─── Session attach helper ────────────────────────────────────────

/** Attach an observer to an EmbodiedAgentSession's first PTY
 *  transport. Returns `{observer, dispose}` · dispose cleans up. */
export function attachObserver(
  session: EmbodiedAgentSession,
  opts: TransportObserverOpts,
): { observer: TransportObserver; dispose: () => void } {
  const pty = session.transports.find((t) => t.kind === 'pty');
  if (!pty) {
    throw new Error(`session ${session.id} has no PTY transport · cannot observe`);
  }
  const observer = new TransportObserver(pty.id, opts);
  return {
    observer,
    dispose: () => observer.dispose(),
  };
}
