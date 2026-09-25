import { debug } from '../debug/log.js';

export const DEFAULT_TOOL_CALL_TIMING_LIMIT = 256;

export interface ToolCallTimingOptions {
  now?: () => number;
  limit?: number;
}

/** Tracks in-flight tool calls so result logs can carry their elapsed time. */
export class ToolCallTiming {
  private readonly starts = new Map<string, number>();
  private readonly now: () => number;
  private readonly limit: number;

  constructor(options: ToolCallTimingOptions = {}) {
    this.now = options.now ?? Date.now;
    this.limit = options.limit ?? DEFAULT_TOOL_CALL_TIMING_LIMIT;
  }

  start(id: string): void {
    // A repeated ID represents the newest invocation and becomes newest for FIFO eviction.
    this.starts.delete(id);
    this.starts.set(id, this.now());

    let evicted = 0;
    while (this.starts.size > this.limit) {
      const oldest = this.starts.keys().next().value;
      if (oldest === undefined) break;
      this.starts.delete(oldest);
      evicted += 1;
    }
    if (evicted > 0) {
      debug.log('chat.tool-timing', 'evicted', {
        evicted,
        size: this.starts.size,
      });
    }
  }

  consume(id: string): number | undefined {
    const startedAt = this.starts.get(id);
    if (startedAt === undefined) return undefined;
    this.starts.delete(id);
    return this.now() - startedAt;
  }

  /** Test-only helper. */
  size(): number {
    return this.starts.size;
  }
}
