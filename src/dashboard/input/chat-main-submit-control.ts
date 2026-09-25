import type { ControlSignalBus } from '../../input/control-signal.js';
import type { TurnSubmit } from '../../input/turn-submit.js';
import { emitTurnSubmitQuickPassSignal } from '../../input/turn-submit-control.js';

export interface MaybeEmitDashboardSubmitQuickPassOpts {
  submit: TurnSubmit;
  isOutputSpeaking: boolean;
  signalBus: ControlSignalBus;
}

export function maybeEmitDashboardSubmitQuickPass(
  opts: MaybeEmitDashboardSubmitQuickPassOpts,
): boolean {
  if (!opts.isOutputSpeaking) return false;
  emitTurnSubmitQuickPassSignal({
    submit: opts.submit,
    signalBus: opts.signalBus,
    scope: {
      channel: 'dashboard',
      surface: 'chat-main',
    },
  });
  return true;
}
