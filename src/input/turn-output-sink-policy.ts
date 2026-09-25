import type { ControlSignalBus, ControlSignalScope } from './control-signal.js';
import type { TurnOutputSinkKind } from './turn-output-sink-registry.js';
import { findRecentQuickPassSignal } from './turn-submit-revision.js';

export interface TurnOutputSinkStopGate {
  signalBus: ControlSignalBus;
  scope: ControlSignalScope;
  sinkKind: TurnOutputSinkKind;
  windowMs?: number;
}

function signalTargetsSink(signal: { payload?: unknown }, sinkKind: TurnOutputSinkKind): boolean {
  const payload = signal.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return true;
  const candidate = (payload as { sinkKind?: unknown }).sinkKind;
  if (typeof candidate !== 'string' || candidate.trim() === '') return true;
  return candidate === sinkKind;
}

export function shouldStopTurnOutputSink(
  opts: TurnOutputSinkStopGate,
): boolean {
  const signal = findRecentQuickPassSignal({
    signalBus: opts.signalBus,
    scope: opts.scope,
    windowMs: opts.windowMs,
    signalKinds: ['output-sink-stop'],
  });
  if (!signal) return false;
  return signalTargetsSink(signal, opts.sinkKind);
}
