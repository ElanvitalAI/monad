import {
  compareSignalUrgency,
  defaultControlSignalBus,
  type ControlSignal,
  type ControlSignalBus,
  type ControlSignalFilter,
} from './control-signal.js';

export interface ControlSignalObserver {
  list(filter?: ControlSignalFilter): readonly ControlSignal[];
  latest(filter?: ControlSignalFilter): ControlSignal | null;
  countsByKind(): Readonly<Record<string, number>>;
  clear(): void;
  detach(): void;
}

export interface ControlSignalObserverOpts {
  maxEntries?: number;
}

export function createControlSignalObserver(
  bus: ControlSignalBus,
  opts: ControlSignalObserverOpts = {},
): ControlSignalObserver {
  const maxEntries = Math.max(1, opts.maxEntries ?? 200);
  let entries: ControlSignal[] = [];

  function matches(filter: ControlSignalFilter, signal: ControlSignal): boolean {
    if (filter.kind && signal.kind !== filter.kind) return false;
    if (filter.minUrgency && compareSignalUrgency(signal.urgency, filter.minUrgency) < 0) return false;
    if (filter.sessionId && signal.scope?.sessionId !== filter.sessionId) return false;
    if (filter.surface && signal.scope?.surface !== filter.surface) return false;
    if (filter.channel && signal.scope?.channel !== filter.channel) return false;
    return true;
  }

  const stop = bus.subscribe({}, (signal) => {
    entries = [...entries, signal];
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries);
    }
  });

  return {
    list(filter = {}) {
      return entries.filter((signal) => matches(filter, signal));
    },
    latest(filter = {}) {
      const matched = entries.filter((signal) => matches(filter, signal));
      return matched.length > 0 ? matched[matched.length - 1] ?? null : null;
    },
    countsByKind() {
      const counts: Record<string, number> = {};
      for (const signal of entries) {
        counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
      }
      return counts;
    },
    clear() {
      entries = [];
    },
    detach() {
      stop();
      entries = [];
    },
  };
}

let _defaultControlSignalObserver: ControlSignalObserver | null = null;

export function defaultControlSignalObserver(): ControlSignalObserver {
  if (!_defaultControlSignalObserver) {
    _defaultControlSignalObserver = createControlSignalObserver(defaultControlSignalBus());
  }
  return _defaultControlSignalObserver;
}

export function _resetDefaultControlSignalObserverForTesting(): void {
  _defaultControlSignalObserver?.detach();
  _defaultControlSignalObserver = null;
}
