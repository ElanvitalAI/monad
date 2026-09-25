import type { ControlSignal, ControlSignalBus, ControlSignalScope } from './control-signal.js';
import type { TurnSubmit } from './turn-submit.js';

export interface EmitTurnSubmitBeginSignalOpts {
  submit: TurnSubmit;
  signalBus: ControlSignalBus;
  scope: ControlSignalScope;
  urgency?: 'normal' | 'priority' | 'quick-pass' | 'critical';
}

export function emitTurnSubmitBeginSignal(
  opts: EmitTurnSubmitBeginSignalOpts,
): ControlSignal {
  return opts.signalBus.emit({
    kind: 'turn-submit-begin',
    urgency: opts.urgency ?? 'normal',
    source: opts.submit.source,
    mayPreempt: false,
    scope: opts.scope,
    payload: {
      submitTarget: opts.submit.target.kind,
      submitSourceKind: opts.submit.source.kind,
    },
  });
}

export interface EmitTurnSubmitQuickPassSignalOpts {
  submit: TurnSubmit;
  signalBus: ControlSignalBus;
  scope: ControlSignalScope;
}

export function emitTurnSubmitQuickPassSignal(
  opts: EmitTurnSubmitQuickPassSignalOpts,
): ControlSignal {
  return opts.signalBus.emit({
    kind: 'turn-submit-preempt-output',
    urgency: 'quick-pass',
    source: opts.submit.source,
    mayPreempt: true,
    scope: opts.scope,
    payload: {
      submitTarget: opts.submit.target.kind,
      submitSourceKind: opts.submit.source.kind,
    },
  });
}
