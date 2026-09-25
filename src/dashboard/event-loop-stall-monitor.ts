import { stripAnsi } from '../tui.js';

export interface EventLoopStallContext {
  streamingInFlight: boolean;
  thinkingMessage: string | null;
}

export interface EventLoopStallMonitorOptions {
  intervalMs?: number;
  thresholdMs?: number;
  now?: () => number;
  setIntervalFn?: (callback: () => void, intervalMs: number) => EventLoopStallTimer;
  clearIntervalFn?: (timer: EventLoopStallTimer) => void;
  getContext: () => EventLoopStallContext;
  log: (category: string, event: string, data: Record<string, unknown>) => void;
}

export interface EventLoopStallTimer {
  unref?: () => void;
}

export function thinkingVerbFromFooter(footer: string | null): 'Routing' | 'Thinking' | 'Streaming' | null {
  if (footer === null) return null;
  return stripAnsi(footer).match(/(Routing|Thinking|Streaming)/)?.[1] as 'Routing' | 'Thinking' | 'Streaming' | undefined ?? null;
}

export function startEventLoopStallMonitor({
  intervalMs = 100,
  thresholdMs = 250,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  getContext,
  log,
}: EventLoopStallMonitorOptions): () => void {
  let previousTickAt = now();
  const timer = setIntervalFn(() => {
    const tickAt = now();
    const lagMs = tickAt - (previousTickAt + intervalMs);
    previousTickAt = tickAt;
    if (lagMs >= thresholdMs) {
      log('tui.event-loop', 'stall', { lagMs, ...getContext() });
    }
  }, intervalMs);
  timer.unref?.();
  log('tui.event-loop', 'monitor-started', { intervalMs, thresholdMs });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    clearIntervalFn(timer);
  };
}
