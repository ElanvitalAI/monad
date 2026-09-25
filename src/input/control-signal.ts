import type { InputSourceRef } from './input-source-kind.js';

export type SignalUrgency =
  | 'background'
  | 'normal'
  | 'priority'
  | 'quick-pass'
  | 'critical';

export interface ControlSignalScope {
  readonly sessionId?: string;
  readonly surface?: string;
  readonly channel?: string;
  readonly deviceId?: string;
}

export interface ControlSignal {
  readonly id: string;
  readonly kind: string;
  readonly urgency: SignalUrgency;
  readonly source: InputSourceRef | 'system' | 'sensor' | 'tool';
  readonly payload?: unknown;
  readonly scope?: ControlSignalScope;
  readonly mayPreempt?: boolean;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly consumedAt?: string;
}

export interface ControlSignalFilter {
  readonly kind?: string;
  readonly minUrgency?: SignalUrgency;
  readonly sessionId?: string;
  readonly surface?: string;
  readonly channel?: string;
}

export type ControlSignalHandler = (signal: ControlSignal) => void;

const URGENCY_ORDER: readonly SignalUrgency[] = [
  'background',
  'normal',
  'priority',
  'quick-pass',
  'critical',
] as const;

export function compareSignalUrgency(a: SignalUrgency, b: SignalUrgency): number {
  return URGENCY_ORDER.indexOf(a) - URGENCY_ORDER.indexOf(b);
}

export function isQuickPassSignal(signal: Pick<ControlSignal, 'urgency'>): boolean {
  return signal.urgency === 'quick-pass' || signal.urgency === 'critical';
}

export interface ControlSignalBus {
  emit(signal: Omit<ControlSignal, 'createdAt' | 'id'> & { id?: string; createdAt?: string }): ControlSignal;
  subscribe(filter: ControlSignalFilter, handler: ControlSignalHandler): () => void;
  promote(signalId: string, urgency: SignalUrgency): ControlSignal | null;
  consumeQuickPass(signalId: string): ControlSignal | null;
  get(signalId: string): ControlSignal | null;
  list(filter?: ControlSignalFilter): readonly ControlSignal[];
  clear(): void;
}

export function createControlSignalBus(now: () => string = () => new Date().toISOString()): ControlSignalBus {
  const byId = new Map<string, ControlSignal>();
  const subscribers = new Set<{
    filter: ControlSignalFilter;
    handler: ControlSignalHandler;
  }>();
  let seq = 0;

  function nextId(): string {
    seq += 1;
    return `ctrl-signal-${seq}`;
  }

  function matches(filter: ControlSignalFilter, signal: ControlSignal): boolean {
    if (filter.kind && signal.kind !== filter.kind) return false;
    if (filter.minUrgency && compareSignalUrgency(signal.urgency, filter.minUrgency) < 0) return false;
    if (filter.sessionId && signal.scope?.sessionId !== filter.sessionId) return false;
    if (filter.surface && signal.scope?.surface !== filter.surface) return false;
    if (filter.channel && signal.scope?.channel !== filter.channel) return false;
    return true;
  }

  function notify(signal: ControlSignal): void {
    for (const sub of subscribers) {
      if (matches(sub.filter, signal)) sub.handler(signal);
    }
  }

  return {
    emit(raw) {
      const signal: ControlSignal = {
        ...raw,
        id: raw.id ?? nextId(),
        createdAt: raw.createdAt ?? now(),
      };
      byId.set(signal.id, signal);
      notify(signal);
      return signal;
    },
    subscribe(filter, handler) {
      const entry = { filter, handler };
      subscribers.add(entry);
      return () => {
        subscribers.delete(entry);
      };
    },
    promote(signalId, urgency) {
      const current = byId.get(signalId);
      if (!current) return null;
      if (compareSignalUrgency(urgency, current.urgency) <= 0) return current;
      const next: ControlSignal = { ...current, urgency };
      byId.set(signalId, next);
      notify(next);
      return next;
    },
    consumeQuickPass(signalId) {
      const current = byId.get(signalId);
      if (!current || !isQuickPassSignal(current) || current.consumedAt) return null;
      const next: ControlSignal = { ...current, consumedAt: now() };
      byId.set(signalId, next);
      return next;
    },
    get(signalId) {
      return byId.get(signalId) ?? null;
    },
    list(filter = {}) {
      return [...byId.values()].filter((signal) => matches(filter, signal));
    },
    clear() {
      byId.clear();
      subscribers.clear();
    },
  };
}

let _defaultControlSignalBus: ControlSignalBus | null = null;

export function defaultControlSignalBus(): ControlSignalBus {
  if (!_defaultControlSignalBus) {
    _defaultControlSignalBus = createControlSignalBus();
  }
  return _defaultControlSignalBus;
}

export function _resetDefaultControlSignalBusForTesting(): void {
  _defaultControlSignalBus?.clear();
  _defaultControlSignalBus = null;
}
