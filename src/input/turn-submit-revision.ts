import type { ControlSignal, ControlSignalBus, ControlSignalScope } from './control-signal.js';

export class TurnSubmitRevisionAbortError extends Error {
  readonly signalId: string | null;
  readonly signalKind: string | null;

  constructor(message: string, opts: { signalId?: string | null; signalKind?: string | null } = {}) {
    super(message);
    this.name = 'TurnSubmitRevisionAbortError';
    this.signalId = opts.signalId ?? null;
    this.signalKind = opts.signalKind ?? null;
  }
}

export interface AbortTurnSubmitOnRecentQuickPassOpts {
  signalBus: ControlSignalBus;
  scope: ControlSignalScope;
  windowMs?: number;
  signalKinds?: readonly string[];
}

export function findRecentQuickPassSignal(
  opts: AbortTurnSubmitOnRecentQuickPassOpts,
): ControlSignal | null {
  const all = opts.signalBus.list({
    minUrgency: 'quick-pass',
    ...(opts.scope.channel ? { channel: opts.scope.channel } : {}),
    ...(opts.scope.surface ? { surface: opts.scope.surface } : {}),
    ...(opts.scope.sessionId ? { sessionId: opts.scope.sessionId } : {}),
  });
  const latest = [...all]
    .reverse()
    .find((signal) => {
      if (signal.consumedAt) return false;
      if (opts.signalKinds?.length && !opts.signalKinds.includes(signal.kind)) return false;
      return true;
    }) ?? null;
  if (!latest) return null;

  const windowMs = Math.max(0, opts.windowMs ?? 5000);
  const ageMs = Date.now() - Date.parse(latest.createdAt);
  if (!Number.isFinite(ageMs) || ageMs > windowMs) return null;
  return latest;
}

export function abortTurnSubmitOnRecentQuickPass(
  opts: AbortTurnSubmitOnRecentQuickPassOpts,
): void {
  const latest = findRecentQuickPassSignal(opts);
  if (!latest) return;
  throw new TurnSubmitRevisionAbortError(
    `submit aborted by recent ${latest.kind} quick-pass signal`,
    { signalId: latest.id, signalKind: latest.kind },
  );
}
