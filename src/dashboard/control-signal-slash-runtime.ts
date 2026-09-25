import type { ControlSignalFilter, SignalUrgency } from '../input/control-signal.js';
import type { ControlSignalObserver } from '../input/control-signal-observer.js';
import type { ControlSignalBus } from '../input/control-signal.js';
import type { InputSourceRef } from '../input/input-source-kind.js';

export interface DashboardControlSignalSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  warning: (text: string) => string;
  observer: ControlSignalObserver;
  signalBus: ControlSignalBus;
}

export interface DashboardControlSignalSlashRuntime {
  usageLines(): string[];
  statusLines(): string[];
  clearLine(): string;
  latestLines(filter?: ControlSignalFilter): string[];
  listLines(limit: number, filter?: ControlSignalFilter): string[];
  emitLines(args: readonly string[]): string[];
  parseFilterTokens(args: readonly string[]): {
    limit: number;
    filter: ControlSignalFilter;
  };
}

interface MutableControlSignalFilter {
  kind?: string;
  minUrgency?: SignalUrgency;
  sessionId?: string;
  surface?: string;
  channel?: string;
}

interface MutableControlSignalEmit {
  kind?: string;
  urgency?: SignalUrgency;
  surface?: string;
  channel?: string;
  sessionId?: string;
  mayPreempt?: boolean;
}

export function createDashboardControlSignalSlashRuntime(
  deps: DashboardControlSignalSlashRuntimeDeps,
): DashboardControlSignalSlashRuntime {
  function formatSignalLine(signal: {
    kind: string;
    urgency: string;
    createdAt: string;
    source: unknown;
    scope?: { surface?: string; channel?: string; sessionId?: string };
    consumedAt?: string;
  }): string {
    const scopeBits: string[] = [];
    if (signal.scope?.surface) scopeBits.push(`surface=${signal.scope.surface}`);
    if (signal.scope?.channel) scopeBits.push(`channel=${signal.scope.channel}`);
    if (signal.scope?.sessionId) scopeBits.push(`session=${signal.scope.sessionId}`);
    const consumed = signal.consumedAt ? ' · consumed' : '';
    return deps.muted(
      `  ${signal.kind} · ${signal.urgency} · ${signal.createdAt}${scopeBits.length ? ` · ${scopeBits.join(' · ')}` : ''} · source=${formatSource(signal.source)}${consumed}`,
    );
  }

  function formatSource(source: unknown): string {
    if (typeof source === 'string') return source;
    if (source && typeof source === 'object' && 'kind' in source && typeof (source as { kind?: unknown }).kind === 'string') {
      const anySource = source as { kind: string; provider?: string; surface?: string };
      const bits = [anySource.kind];
      if (typeof anySource.provider === 'string' && anySource.provider) bits.push(anySource.provider);
      if (typeof anySource.surface === 'string' && anySource.surface) bits.push(anySource.surface);
      return bits.join('/');
    }
    return 'unknown';
  }

  function parseFilterTokens(args: readonly string[]): { limit: number; filter: ControlSignalFilter } {
    let limit = 10;
    const filter: MutableControlSignalFilter = {};
    for (const raw of args) {
      const token = raw.trim();
      if (!token) continue;
      if (/^\d+$/.test(token)) {
        limit = Math.max(1, Math.min(50, Number(token)));
        continue;
      }
      const idx = token.indexOf('=');
      if (idx <= 0) continue;
      const key = token.slice(0, idx).toLowerCase();
      const value = token.slice(idx + 1).trim();
      if (!value) continue;
      switch (key) {
        case 'kind':
          filter.kind = value;
          break;
        case 'surface':
          filter.surface = value;
          break;
        case 'channel':
          filter.channel = value;
          break;
        case 'session':
        case 'sessionid':
          filter.sessionId = value;
          break;
        case 'urgency':
        case 'minurgency':
          filter.minUrgency = value as SignalUrgency;
          break;
      }
    }
    return { limit, filter };
  }

  function parseEmitTokens(args: readonly string[]): { ok: true; value: Required<Pick<MutableControlSignalEmit, 'kind'>> & MutableControlSignalEmit } | { ok: false; reason: string } {
    const emit: MutableControlSignalEmit = {
      urgency: 'normal',
    };
    for (const raw of args) {
      const token = raw.trim();
      if (!token) continue;
      const idx = token.indexOf('=');
      if (idx <= 0) continue;
      const key = token.slice(0, idx).toLowerCase();
      const value = token.slice(idx + 1).trim();
      if (!value) continue;
      switch (key) {
        case 'kind':
          emit.kind = value;
          break;
        case 'urgency':
          if (
            value === 'background'
            || value === 'normal'
            || value === 'priority'
            || value === 'quick-pass'
            || value === 'critical'
          ) {
            emit.urgency = value;
          } else {
            return { ok: false, reason: 'urgency must be background | normal | priority | quick-pass | critical' };
          }
          break;
        case 'surface':
          emit.surface = value;
          break;
        case 'channel':
          emit.channel = value;
          break;
        case 'session':
        case 'sessionid':
          emit.sessionId = value;
          break;
        case 'preempt':
        case 'maypreempt':
          if (value === 'true' || value === '1' || value === 'yes') emit.mayPreempt = true;
          else if (value === 'false' || value === '0' || value === 'no') emit.mayPreempt = false;
          else return { ok: false, reason: 'mayPreempt must be true | false' };
          break;
      }
    }
    if (!emit.kind) return { ok: false, reason: 'kind=... required' };
    return { ok: true, value: emit as Required<Pick<MutableControlSignalEmit, 'kind'>> & MutableControlSignalEmit };
  }

  function buildSlashSource(): InputSourceRef {
    return { kind: 'keyboard', surface: 'dashboard-chat-main' };
  }

  return {
    usageLines: () => [
      '',
      deps.accent('❯ /signals'),
      deps.muted('  /signals status'),
      deps.muted('  /signals list [limit] [kind=...] [surface=...] [channel=...] [session=...] [urgency=...]'),
      deps.muted('  /signals latest [kind=...] [surface=...] [channel=...] [session=...] [urgency=...]'),
      deps.muted('  /signals emit kind=... [urgency=...] [surface=...] [channel=...] [session=...] [mayPreempt=true|false]'),
      deps.muted('  /signals clear'),
    ],
    statusLines: () => {
      const counts = deps.observer.countsByKind();
      const entries = Object.entries(counts);
      if (entries.length === 0) {
        return [deps.muted('  control-signals: empty')];
      }
      return [
        deps.muted(`  control-signals: ${entries.reduce((sum, [, count]) => sum + count, 0)} observed`),
        ...entries.map(([kind, count]) => deps.muted(`    ${kind} · ${count}`)),
      ];
    },
    clearLine: () => deps.muted('  control-signals: observer timeline cleared'),
    latestLines: (filter = {}) => {
      const latest = deps.observer.latest(filter);
      if (!latest) return [deps.warning('  control-signals: no matching signal')];
      return [formatSignalLine(latest)];
    },
    listLines: (limit, filter = {}) => {
      const items = deps.observer.list(filter);
      if (items.length === 0) return [deps.warning('  control-signals: no matching signals')];
      return items.slice(-limit).map(formatSignalLine);
    },
    emitLines: (args) => {
      const parsed = parseEmitTokens(args);
      if (!parsed.ok) return [deps.warning(`  control-signals: ${parsed.reason}`)];
      const signal = deps.signalBus.emit({
        kind: parsed.value.kind,
        urgency: parsed.value.urgency ?? 'normal',
        source: buildSlashSource(),
        ...(parsed.value.mayPreempt !== undefined ? { mayPreempt: parsed.value.mayPreempt } : {}),
        scope: {
          ...(parsed.value.surface ? { surface: parsed.value.surface } : {}),
          ...(parsed.value.channel ? { channel: parsed.value.channel } : {}),
          ...(parsed.value.sessionId ? { sessionId: parsed.value.sessionId } : {}),
        },
      });
      return [
        deps.muted(
          `  emitted ${signal.kind} · ${signal.urgency}${signal.scope?.surface ? ` · surface=${signal.scope.surface}` : ''}${signal.scope?.channel ? ` · channel=${signal.scope.channel}` : ''}${signal.scope?.sessionId ? ` · session=${signal.scope.sessionId}` : ''}`,
        ),
      ];
    },
    parseFilterTokens,
  };
}
