// H6 P5 · Reply capture · observer snapshot diff + idle-detect poll.
//
// Design rails (PLAN §D2, §D4, §R2):
//   - D2  Idle detection (no new bytes across channels for idleMs) ·
//         hybrid turn-complete via channel-router deferred to Bundle 2.
//   - D4  Observer is the source of truth — we don't subscribe to
//         pty events ourselves · just diff the observer's per-channel
//         accumulators before and after.
//   - R2  Observer buffer is capped (64 KB rolling) · if the reply
//         body exceeds that cap, the pre-mark portion gets evicted.
//         We detect this by comparing current length vs stored mark
//         length and flag `'buffer-rolled'` in warnings.

import type { TransportObserver, ChannelSnapshot } from './transport-observer.js';

export interface CollectOpts {
  readonly idleMs: number;
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Poll cadence · default 100ms · shorter = more responsive idle
   *  detection at the cost of more CPU. */
  readonly pollMs?: number;
}

export interface CollectResult {
  readonly delta: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  /** Total bytes across all channels. Useful for sizing metadata. */
  readonly totalBytes: number;
}

const DEFAULT_POLL_MS = 100;

export class ReplyCapture {
  private startLengths: Record<string, number> = {};
  private markedAt = 0;

  /** Record current per-channel lengths so `collect*` can diff
   *  against them. Called BEFORE sending the reply message. */
  mark(observer: TransportObserver, now: () => number = Date.now): void {
    this.startLengths = {};
    this.markedAt = now();
    const snap = observer.snapshotChannels();
    for (const [ch, buf] of Object.entries(snap)) {
      this.startLengths[ch] = buf.length;
    }
  }

  /** Return the delta relative to the last `mark`, without waiting.
   *  Test seam + Bundle 2 streaming entry point. */
  peekDelta(observer: TransportObserver): Readonly<Record<string, string>> {
    return this.computeDelta(observer.snapshotChannels()).delta;
  }

  /** Poll until no new bytes across channels for `idleMs` OR
   *  `timeoutMs` elapsed. Returns the cumulative delta since mark. */
  async collectUntilIdle(
    observer: TransportObserver,
    opts: CollectOpts,
  ): Promise<CollectResult> {
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const start = opts.now();
    let lastByteCount = totalBytes(observer.snapshotChannels());
    let lastChangeAt = start;
    const warnings: string[] = [];
    let timedOut = false;

    // Fast-path: if the observer had content on first mark, we still
    // need to wait for the reply to *start*. We only call "idle" when
    // there's been NO change for idleMs and at least one sample fired.
    while (true) {
      await opts.sleep(pollMs);
      const nowAt = opts.now();
      const elapsed = nowAt - start;
      if (elapsed >= opts.timeoutMs) {
        timedOut = true;
        warnings.push('timeout-truncated');
        break;
      }
      const byteCount = totalBytes(observer.snapshotChannels());
      if (byteCount !== lastByteCount) {
        lastByteCount = byteCount;
        lastChangeAt = nowAt;
        continue;
      }
      // No change this tick · is idle window satisfied?
      if (nowAt - lastChangeAt >= opts.idleMs) break;
    }

    const { delta, rolled } = this.computeDelta(observer.snapshotChannels());
    if (rolled) warnings.push('buffer-rolled');
    const totals = Object.values(delta).reduce((n, s) => n + s.length, 0);
    // Surface elapsed-to-idle for the caller's metadata if it wants
    // to include it; the caller has its own clock so we just return
    // warnings + delta.
    if (!timedOut && totals === 0) {
      warnings.push('empty-delta');
    }
    return { delta, warnings, totalBytes: totals };
  }

  /** Exposed for tests — compute delta from a snapshot without
   *  triggering a poll. */
  computeDelta(snap: ChannelSnapshot): {
    delta: Record<string, string>;
    rolled: boolean;
  } {
    const delta: Record<string, string> = {};
    let rolled = false;
    for (const [ch, buf] of Object.entries(snap)) {
      const startLen = this.startLengths[ch] ?? 0;
      if (buf.length < startLen) {
        // Observer cap rotation: current is shorter than mark ·
        // everything currently in the buffer is post-mark
        // (conservatively) · flag rolled.
        delta[ch] = buf;
        rolled = true;
      } else if (buf.length > startLen) {
        delta[ch] = buf.slice(startLen);
      }
      // else: length unchanged · channel contributed nothing
    }
    return { delta, rolled };
  }

  markedAtMs(): number {
    return this.markedAt;
  }
}

function totalBytes(snap: ChannelSnapshot): number {
  let n = 0;
  for (const v of Object.values(snap)) n += v.length;
  return n;
}

/** Convenience sleep that plays nice with test fake-timers. Exported
 *  so callers (`reply.ts` default deps) can reuse. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
